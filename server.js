const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();

app.use(cors());
app.use(express.json());

// ----------------------------------------
// PARSE GRADES FROM IFRAME TEXT
// ----------------------------------------
// The iframe's innerText looks like:
//   ELA11500A - 3 GT HumanitiesI/Eng 1 Adv S1
//   (Last Updated: 9/1/2026)
//   Student Grades 92.00%
//   Date Due  Date Assigned  Assignment  Category  Score  Total Points
//   10/02/2026 ... (assignment rows)
//   FNA25117A - 1 Band C: YR 1 S1
//   ...
// Some class headers have no grade/updated lines under them (no data
// for that report period) — those are still returned, with grade: null.
function parseGrades(bodyText) {
  const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);

  // Matches lines like "ELA11500A - 3 GT HumanitiesI/Eng 1 Adv S1"
  const classRegex = /^[A-Z]{2,6}\d{3,6}[A-Z]?\s*-\s*\d+\s+.+/;
  const gradeRegex = /Student Grades\s+([\d.]+)%/;
  const updatedRegex = /Last Updated:\s*([\d/]+)/;

  const classes = [];
  let current = null;

  for (const line of lines) {
    if (classRegex.test(line)) {
      if (current) classes.push(current);
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

  if (current) classes.push(current);

  return classes;
}

app.post('/api/grades', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const loginUrl =
      'https://hac.friscoisd.org/HomeAccess/Account/LogOn?ReturnUrl=%2FHomeAccess%2FClasses%2FClasswork';

    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    await page.waitForSelector('#LogOnDetails_UserName', { visible: true, timeout: 15000 });
    await page.waitForSelector('#LogOnDetails_Password', { visible: true, timeout: 15000 });

    await page.type('#LogOnDetails_UserName', username, { delay: 10 });
    await page.type('#LogOnDetails_Password', password, { delay: 10 });

    await Promise.all([
      page.click('button[type="submit"], input[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null)
    ]);

    if (page.url().includes('/Account/LogOn')) {
      await browser.close();
      return res.status(401).json({ error: 'HAC login was not successful.' });
    }

    // Give the Classwork page time to settle
    await new Promise(resolve => setTimeout(resolve, 3000));

    const iframeElement = await page.$('#sg-legacy-iframe');

    if (!iframeElement) {
      await browser.close();
      return res.status(500).json({ error: 'The HAC Classwork iframe could not be found.' });
    }

    const frame = await iframeElement.contentFrame();

    if (!frame) {
      await browser.close();
      return res.status(500).json({ error: 'Could not access the Classwork iframe contents.' });
    }

    // Give the AJAX-loaded grade data time to render inside the iframe
    await new Promise(resolve => setTimeout(resolve, 5000));

    const bodyText = await frame.evaluate(() => document.body.innerText);

    const classes = parseGrades(bodyText);

    await browser.close();

    console.log(`Parsed ${classes.length} classes.`);

    return res.json({ classes });

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

app.listen(3000, () => {
  console.log('HAC Grade Viewer server running on http://localhost:3000');
});