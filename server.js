const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function parseGrades(bodyText) {
  const lines = bodyText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const classRegex = /^[A-Z]{2,6}\d{3,6}[A-Z]?\s*-\s*\d+\s+.+/;
  const gradeRegex = /Student Grades\s+([\d.]+)%/;
  const updatedRegex = /Last Updated:\s*([\d/]+)/;

  const classes = [];
  let current = null;

  for (const line of lines) {
    if (classRegex.test(line)) {
      if (current) {
        classes.push(current);
      }

      current = {
        className: line,
        grade: null,
        lastUpdated: null
      };

      continue;
    }

    if (!current) continue;

    const gradeMatch = line.match(gradeRegex);

    if (gradeMatch) {
      current.grade = `${gradeMatch[1]}%`;
      continue;
    }

    const updatedMatch = line.match(updatedRegex);

    if (updatedMatch) {
      current.lastUpdated = updatedMatch[1];
    }
  }

  if (current) {
    classes.push(current);
  }

  return classes;
}

function findLocalChrome() {
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ];

  return chromePaths.find(filePath =>
    fs.existsSync(filePath)
  );
}

async function launchBrowser() {
  const puppeteerModule = await import('puppeteer-core');
  const puppeteer = puppeteerModule.default;

  // Local Mac development
  if (require.main === module) {
    const chromePath = findLocalChrome();

    if (!chromePath) {
      throw new Error(
        'Google Chrome could not be found on this Mac.'
      );
    }

    console.log('Running in LOCAL mode.');
    console.log('Using Chrome:');
    console.log(chromePath);

    return puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote'
      ]
    });
  }

  // Vercel production
  const chromiumModule = await import(
    '@sparticuz/chromium-min'
  );

  const chromium = chromiumModule.default;

  console.log('Running in VERCEL mode.');
  console.log('Preparing Sparticuz Chromium...');

  const packPath = path.join(
    process.cwd(),
    'public',
    'chromium-pack.tar'
  );

  if (!fs.existsSync(packPath)) {
    throw new Error(
      `Chromium package not found at ${packPath}`
    );
  }

  console.log('Chromium package found:');
  console.log(packPath);

  const executablePath =
    await chromium.executablePath(packPath);

  console.log(
    'Chromium executable:',
    executablePath
  );

  return puppeteer.launch({
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote'
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless
  });
}

app.post('/api/grades', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      error: 'Username and password are required.'
    });
  }

  let browser = null;

  try {
    console.log('');
    console.log('========================================');
    console.log('Starting HAC grade check...');
    console.log('========================================');

    console.log('1. Launching browser...');

    browser = await launchBrowser();

    console.log('2. Browser launched successfully.');

    const page = await browser.newPage();

    await page.setViewport({
      width: 1440,
      height: 900
    });

    const loginUrl =
      'https://hac.friscoisd.org/HomeAccess/Account/LogOn?ReturnUrl=%2FHomeAccess%2FClasses%2FClasswork';

    console.log('3. Loading HAC...');

    await page.goto(loginUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log('4. HAC login page loaded.');

    console.log('5. Waiting for login fields...');

    await page.waitForSelector(
      '#LogOnDetails_UserName',
      {
        visible: true,
        timeout: 15000
      }
    );

    await page.waitForSelector(
      '#LogOnDetails_Password',
      {
        visible: true,
        timeout: 15000
      }
    );

    console.log('6. Entering credentials...');

    await page.type(
      '#LogOnDetails_UserName',
      username,
      {
        delay: 10
      }
    );

    await page.type(
      '#LogOnDetails_Password',
      password,
      {
        delay: 10
      }
    );

    console.log('7. Submitting HAC login...');

    await Promise.all([
      page.click(
        'button[type="submit"], input[type="submit"]'
      ),

      page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 30000
      }).catch(() => null)
    ]);

    console.log(
      '8. Current HAC URL:',
      page.url()
    );

    if (page.url().includes('/Account/LogOn')) {
      return res.status(401).json({
        error: 'HAC login was not successful.'
      });
    }

    console.log('9. HAC login successful.');

    await new Promise(resolve => {
      setTimeout(resolve, 3000);
    });

    console.log('10. Looking for Classwork iframe...');

    const iframeElement = await page.$(
      '#sg-legacy-iframe'
    );

    if (!iframeElement) {
      return res.status(500).json({
        error:
          'The HAC Classwork iframe could not be found.'
      });
    }

    const frame =
      await iframeElement.contentFrame();

    if (!frame) {
      return res.status(500).json({
        error:
          'Could not access the Classwork iframe contents.'
      });
    }

    console.log('11. Classwork iframe found.');

    await new Promise(resolve => {
      setTimeout(resolve, 5000);
    });

    console.log('12. Reading grade information...');

    const bodyText = await frame.evaluate(() => {
      return document.body.innerText;
    });

    const classes = parseGrades(bodyText);

    console.log(
      `13. Parsed ${classes.length} classes.`
    );

    return res.json({
      classes
    });

  } catch (error) {
    console.error('');
    console.error('========================================');
    console.error('HAC scrape error');
    console.error('========================================');
    console.error(error);

    return res.status(500).json({
      error: 'Failed to communicate with HAC.',
      details: error.message
    });

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log('========================================');
    console.log('HAC Grade Viewer - LOCAL SERVER');
    console.log('========================================');
    console.log('');
    console.log(`Server running at: http://localhost:${PORT}`);
    console.log('');
    console.log('Open that address in your browser.');
    console.log('Press Ctrl+C to stop the server.');
    console.log('');
  });
}

module.exports = app;
