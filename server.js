const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function parseGrades(bodyText) {
  const lines = bodyText
    .split('\n')
    .map(l => l.trim())
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

app.post('/api/grades', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      error: 'Username and password are required.'
    });
  }

  let browser;

  try {
    console.log('========================================');
    console.log('Starting HAC grade check...');
    console.log('========================================');

    // Puppeteer is imported dynamically because Vercel
    // runs this project as CommonJS while Puppeteer is ESM.
    const puppeteer = await import('puppeteer');

    console.log('1. Opening HAC login page...');

    browser = await puppeteer.default.launch({
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

    const page = await browser.newPage();

    await page.setViewport({
      width: 1440,
      height: 900
    });

    const loginUrl =
      'https://hac.friscoisd.org/HomeAccess/Account/LogOn?ReturnUrl=%2FHomeAccess%2FClasses%2FClasswork';

    console.log('2. Loading HAC...');

    await page.goto(loginUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log('3. Waiting for login fields...');

    await page.waitForSelector('#LogOnDetails_UserName', {
      visible: true,
      timeout: 15000
    });

    await page.waitForSelector('#LogOnDetails_Password', {
      visible: true,
      timeout: 15000
    });

    console.log('4. Entering credentials...');

    await page.type(
      '#LogOnDetails_UserName',
      username,
      { delay: 10 }
    );

    await page.type(
      '#LogOnDetails_Password',
      password,
      { delay: 10 }
    );

    console.log('5. Submitting HAC login...');

    await Promise.all([
      page.click(
        'button[type="submit"], input[type="submit"]'
      ),

      page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 30000
      }).catch(() => null)
    ]);

    console.log('6. Current HAC URL:', page.url());

    if (page.url().includes('/Account/LogOn')) {
      await browser.close();

      return res.status(401).json({
        error: 'HAC login was not successful.'
      });
    }

    console.log('7. HAC login successful.');

    await new Promise(resolve =>
      setTimeout(resolve, 3000)
    );

    console.log('8. Looking for Classwork iframe...');

    const iframeElement = await page.$(
      '#sg-legacy-iframe'
    );

    if (!iframeElement) {
      await browser.close();

      return res.status(500).json({
        error:
          'The HAC Classwork iframe could not be found.'
      });
    }

    const frame = await iframeElement.contentFrame();

    if (!frame) {
      await browser.close();

      return res.status(500).json({
        error:
          'Could not access the Classwork iframe contents.'
      });
    }

    console.log('9. Classwork iframe found.');

    await new Promise(resolve =>
      setTimeout(resolve, 5000)
    );

    console.log('10. Reading grade information...');

    const bodyText = await frame.evaluate(() => {
      return document.body.innerText;
    });

    const classes = parseGrades(bodyText);

    console.log(
      `11. Parsed ${classes.length} classes.`
    );

    await browser.close();

    console.log('12. HAC grade check completed.');

    return res.json({
      classes
    });

  } catch (error) {
    console.error('HAC scrape error:', error);

    if (browser) {
      await browser.close().catch(() => {});
    }

    return res.status(500).json({
      error: 'Failed to communicate with HAC.',
      details: error.message
    });
  }
});

module.exports = app;
