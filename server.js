require('dotenv').config({ path: '.env.local' });

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { Redis } = require('@upstash/redis');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// REDIS
// ============================================================

const redis = new Redis({
  url:
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL,

  token:
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN
});

// ============================================================
// SESSION SETTINGS
// ============================================================

const SESSION_TTL = 30 * 24 * 60 * 60;

// ============================================================
// CORS
// ============================================================

app.use(
  cors({
    origin: function (origin, callback) {
      console.log(
        'Incoming request origin:',
        origin || 'none'
      );

      if (!origin) {
        return callback(null, true);
      }

      const allowed =
        origin.startsWith('http://localhost') ||
        origin.startsWith('http://127.0.0.1') ||
        origin.endsWith('.vercel.app') ||
        origin === 'https://sites.google.com' ||
        origin.endsWith('.googleusercontent.com');

      if (allowed) {
        return callback(null, true);
      }

      console.log(
        'CORS blocked origin:',
        origin
      );

      return callback(null, false);
    },

    credentials: true,

    allowedHeaders: [
      'Content-Type',
      'X-Session-ID'
    ],

    methods: [
      'GET',
      'POST',
      'OPTIONS'
    ]
  })
);

app.use(express.json());

// ============================================================
// SERVE INDEX.HTML FROM PROJECT ROOT
// ============================================================

app.get('/', (req, res) => {
  const indexPath =
    path.join(__dirname, 'index.html');

  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }

  return res.status(404).send(
    'index.html not found'
  );
});

// ============================================================
// TEMPORARY COOKIE TEST
// ============================================================

app.get('/api/cookie-test', (req, res) => {
  try {
    const cookies =
      req.headers.cookie || '';

    const match =
      cookies.match(
        /(?:^|;\s*)cookie_test=([^;]+)/
      );

    let cookieId;
    let existing = false;

    if (match) {
      cookieId =
        decodeURIComponent(match[1]);

      existing = true;

    } else {

      cookieId =
        crypto.randomBytes(32).toString('hex');

      res.setHeader(
        'Set-Cookie',
        `cookie_test=${encodeURIComponent(cookieId)}; Max-Age=86400; Path=/; Secure; SameSite=None`
      );
    }

    console.log('');
    console.log(
      '========== COOKIE TEST =========='
    );
    console.log(
      'Cookie already existed:',
      existing ? 'YES' : 'NO'
    );
    console.log(
      'Cookie ID:',
      cookieId
    );
    console.log(
      '================================='
    );
    console.log('');

    return res.json({
      success: true,
      existing,
      cookieId
    });

  } catch (error) {

    console.error(
      'Cookie test error:',
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// REDIS TEST
// ============================================================

app.get('/api/redis-test', async (req, res) => {
  try {
    const testKey =
      'hac:redis-test';

    await redis.set(
      testKey,
      'working',
      {
        ex: 300
      }
    );

    const value =
      await redis.get(testKey);

    return res.json({
      success: true,
      value
    });

  } catch (error) {

    console.error(
      'Redis test error:',
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// CHECK SAVED SESSION
// ============================================================

app.get('/api/session', async (req, res) => {
  try {

    const sessionId =
      req.headers['x-session-id'];

    console.log('');
    console.log(
      '========== SESSION CHECK =========='
    );
    console.log(
      'Received session ID:',
      sessionId ? 'YES' : 'NO'
    );

    if (
      !sessionId ||
      typeof sessionId !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(sessionId)
    ) {

      console.log(
        'No valid session ID'
      );

      console.log(
        '=================================='
      );

      return res.json({
        authenticated: false,
        remembered: false
      });
    }

    const key =
      `hac:session:${sessionId}`;

    const session =
      await redis.get(key);

    if (!session) {

      console.log(
        'Session not found in Redis'
      );

      console.log(
        '=================================='
      );

      return res.json({
        authenticated: false,
        remembered: false
      });
    }

    const updatedSession = {
      ...session,
      lastSeen:
        new Date().toISOString()
    };

    await redis.set(
      key,
      updatedSession,
      {
        ex: SESSION_TTL
      }
    );

    console.log(
      'Saved session FOUND'
    );

    console.log(
      '=================================='
    );

    return res.json({
      authenticated: true,
      remembered: true,
      sessionId,
      lastSeen:
        updatedSession.lastSeen
    });

  } catch (error) {

    console.error(
      'Session check error:',
      error
    );

    return res.status(500).json({
      authenticated: false,
      remembered: false,
      error: error.message
    });
  }
});

// ============================================================
// LOGOUT
// ============================================================

app.post('/api/logout', async (req, res) => {
  try {

    const sessionId =
      req.headers['x-session-id'];

    if (
      sessionId &&
      typeof sessionId === 'string' &&
      /^[a-f0-9]{64}$/i.test(sessionId)
    ) {

      await redis.del(
        `hac:session:${sessionId}`
      );

      console.log(
        'Deleted session:',
        sessionId
      );
    }

    return res.json({
      success: true
    });

  } catch (error) {

    console.error(
      'Logout error:',
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// HAC LOGIN + GRADES
// ============================================================

app.post('/api/grades', async (req, res) => {

  let browser = null;

  try {

    const {
      username,
      password
    } = req.body;

    if (!username || !password) {

      return res.status(400).json({
        success: false,
        error:
          'Username and password are required.'
      });
    }

    console.log('');
    console.log(
      '========================================'
    );
    console.log(
      'HAC LOGIN REQUEST'
    );
    console.log(
      '========================================'
    );

    const puppeteer =
      await import('puppeteer-core');

    let executablePath;

    // ========================================================
    // LOCAL CHROME
    // ========================================================

    if (!process.env.VERCEL) {

      const possibleChromePaths = [

        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',

        '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',

        '/Applications/Chromium.app/Contents/MacOS/Chromium'

      ];

      executablePath =
        possibleChromePaths.find(
          filePath =>
            fs.existsSync(filePath)
        );

      if (!executablePath) {

        throw new Error(
          'Could not find Google Chrome on this computer.'
        );
      }

      console.log(
        'Using local Chrome:',
        executablePath
      );
    }

    // ========================================================
    // VERCEL CHROMIUM
    // ========================================================

    if (process.env.VERCEL) {

      const chromium =
        require('@sparticuz/chromium-min');

      executablePath =
        await chromium.executablePath(
          path.join(
            process.cwd(),
            'public'
          )
        );

      console.log(
        'Using Vercel Chromium:',
        executablePath
      );
    }

    // ========================================================
    // START BROWSER
    // ========================================================

    browser =
      await puppeteer.default.launch({

        executablePath,

        headless: true,

        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process'
        ],

        defaultViewport: {
          width: 1365,
          height: 900
        }
      });

    const page =
      await browser.newPage();

    page.setDefaultTimeout(
      30000
    );

    // ========================================================
    // HAC LOGIN PAGE
    // ========================================================

    console.log(
      'Opening HAC login page...'
    );

    await page.goto(
      'https://hac.friscoisd.org/HomeAccess/Account/LogOn?ReturnUrl=%2FHomeAccess%2FClasses%2FClasswork',
      {
        waitUntil:
          'domcontentloaded',

        timeout:
          30000
      }
    );

    // ========================================================
    // ENTER LOGIN
    // ========================================================

    await page.waitForSelector(
      '#LogOnDetails_UserName',
      {
        visible: true
      }
    );

    await page.waitForSelector(
      '#LogOnDetails_Password',
      {
        visible: true
      }
    );

    await page.type(
      '#LogOnDetails_UserName',
      username
    );

    await page.type(
      '#LogOnDetails_Password',
      password
    );

    console.log(
      'Submitting HAC login...'
    );

    await Promise.all([

      page.click(
        'input[type="submit"]'
      ),

      page.waitForNavigation({
        waitUntil:
          'domcontentloaded',

        timeout:
          30000
      }).catch(() => {})
    ]);

    // ========================================================
    // CHECK LOGIN
    // ========================================================

    const currentUrl =
      page.url();

    console.log(
      'After login URL:',
      currentUrl
    );

    if (
      currentUrl.includes(
        '/Account/LogOn'
      )
    ) {

      throw new Error(
        'HAC login was not successful. Please check your username and password.'
      );
    }

    // ========================================================
    // FIND GRADE IFRAME
    // ========================================================

    console.log(
      'Waiting for HAC grade iframe...'
    );

    await page.waitForSelector(
      '#sg-legacy-iframe',
      {
        timeout:
          30000
      }
    );

    const iframeElement =
      await page.$(
        '#sg-legacy-iframe'
      );

    if (!iframeElement) {

      throw new Error(
        'Could not find HAC grade iframe.'
      );
    }

    const frame =
      await iframeElement.contentFrame();

    if (!frame) {

      throw new Error(
        'Could not access HAC grade iframe.'
      );
    }

    // ========================================================
    // WAIT FOR GRADE CONTENT
    // ========================================================

    await frame.waitForFunction(
      () => {

        return (
          document.body &&
          document.body.innerText &&
          document.body.innerText.length > 100
        );

      },
      {
        timeout:
          30000
      }
    );

    const bodyText =
      await frame.evaluate(
        () => document.body.innerText
      );

    console.log(
      'Grade page loaded.'
    );

    // ========================================================
    // PARSE GRADES
    // ========================================================

    const grades = [];

    const sections =
      bodyText.split(
        /(?=Student Grades)/gi
      );

    for (
      const section of sections
    ) {

      const gradeMatch =
        section.match(
          /Student Grades\s*([0-9]+(?:\.[0-9]+)?)%/i
        );

      const updatedMatch =
        section.match(
          /Last Updated:\s*([^\n]+)/i
        );

      const classMatch =
        section.match(
          /([A-Z]{2,6}\d{3,6}[A-Z0-9]*\s*-\s*[^\n]+)/i
        );

      if (!gradeMatch) {
        continue;
      }

      const grade =
        Number(
          gradeMatch[1]
        );

      const className =
        classMatch
          ? classMatch[1].trim()
          : 'Unknown Class';

      const lastUpdated =
        updatedMatch
          ? updatedMatch[1].trim()
          : null;

      grades.push({
        className,
        grade,
        lastUpdated
      });
    }

    console.log(
      'Grades found:',
      grades.length
    );

    if (grades.length === 0) {

      throw new Error(
        'Could not find any grades on the HAC page.'
      );
    }

    // ========================================================
    // SAVE SESSION TO REDIS
    // ========================================================

    const sessionId =
      crypto.randomBytes(32).toString('hex');

    const sessionData = {

      createdAt:
        new Date().toISOString(),

      lastSeen:
        new Date().toISOString(),

      grades
    };

    await redis.set(
      `hac:session:${sessionId}`,
      sessionData,
      {
        ex:
          SESSION_TTL
      }
    );

    console.log(
      'Saved HAC session:',
      sessionId
    );

    // ========================================================
    // RETURN GRADES
    // ========================================================

    return res.json({

      success: true,

      grades,

      sessionId

    });

  } catch (error) {

    console.error('');
    console.error(
      '========================================'
    );
    console.error(
      'HAC ERROR'
    );
    console.error(
      '========================================'
    );
    console.error(
      error
    );
    console.error(
      '========================================'
    );
    console.error('');

    return res.status(500).json({

      success: false,

      error:
        error.message ||
        'HAC login failed.'

    });

  } finally {

    if (browser) {

      try {

        await browser.close();

      } catch (error) {

        console.error(
          'Browser close error:',
          error
        );
      }
    }
  }
});

// ============================================================
// START SERVER
// ============================================================

if (require.main === module) {

  app.listen(
    PORT,
    () => {

      console.log('');
      console.log(
        '========================================'
      );
      console.log(
        `Server running on http://localhost:${PORT}`
      );
      console.log(
        '========================================'
      );
      console.log('');
    }
  );
}

module.exports = app;

