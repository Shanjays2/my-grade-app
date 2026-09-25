require('dotenv').config({ path: '.env.local' });

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { Redis } = require('@upstash/redis');

const app = express();

/*
============================================================
CORS
============================================================
*/

app.use(
  cors({
    origin: (origin, callback) => {
      console.log(
        'Incoming request origin:',
        origin || 'none'
      );

      if (!origin) {
        return callback(null, true);
      }

      try {
        const url = new URL(origin);
        const hostname = url.hostname;

        // Local development
        if (
          hostname === 'localhost' ||
          hostname === '127.0.0.1'
        ) {
          return callback(null, true);
        }

        // Vercel
        if (
          hostname.endsWith('.vercel.app')
        ) {
          return callback(null, true);
        }

        // Google Sites
        if (
          hostname === 'sites.google.com' ||
          hostname.endsWith('.sites.google.com')
        ) {
          return callback(null, true);
        }

        // Google Sites embedded content
        if (
          hostname.endsWith('.googleusercontent.com')
        ) {
          return callback(null, true);
        }

        console.log(
          'Blocked CORS origin:',
          origin
        );

        return callback(
          new Error('Not allowed by CORS')
        );

      } catch (error) {
        console.log(
          'Invalid CORS origin:',
          origin
        );

        return callback(
          new Error('Not allowed by CORS')
        );
      }
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


/*
============================================================
UPSTASH REDIS
============================================================
*/

const redis = new Redis({
  url:
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL,

  token:
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN
});


/*
============================================================
SESSION SETTINGS
============================================================
*/

const SESSION_TTL =
  30 * 24 * 60 * 60;

const SESSION_COOKIE_NAME =
  'hac_session';


/*
============================================================
REDIS TEST
============================================================
*/

app.get('/api/redis-test', async (req, res) => {
  try {
    const testKey =
      `redis:test:${crypto.randomBytes(8).toString('hex')}`;

    const testValue = {
      message: 'Redis is working!',
      time: new Date().toISOString()
    };

    await redis.set(
      testKey,
      JSON.stringify(testValue),
      {
        ex: 60
      }
    );

    const saved =
      await redis.get(testKey);

    await redis.del(testKey);

    return res.json({
      success: true,
      message: 'Redis is working!',
      redis: saved ? 'connected' : 'failed'
    });

  } catch (error) {
    console.error(
      'Redis test error:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Redis test failed.',
      error: error.message
    });
  }
});


/*
============================================================
TEMPORARY COOKIE TEST
============================================================
*/

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
        crypto
          .randomBytes(32)
          .toString('hex');

      const isProduction =
        !!process.env.VERCEL;

      const cookieParts = [
        `cookie_test=${encodeURIComponent(cookieId)}`,
        'Max-Age=86400',
        'Path=/'
      ];

      if (isProduction) {
        cookieParts.push('Secure');
        cookieParts.push('SameSite=None');
      } else {
        cookieParts.push('SameSite=Lax');
      }

      res.setHeader(
        'Set-Cookie',
        cookieParts.join('; ')
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


/*
============================================================
HOME PAGE
============================================================
*/

app.get('/', (req, res) => {
  const indexPath =
    path.join(__dirname, 'index.html');

  if (!fs.existsSync(indexPath)) {
    return res.status(404).send(
      'index.html not found'
    );
  }

  return res.sendFile(indexPath);
});


/*
============================================================
GET SESSION ID FROM COOKIE
============================================================
*/

function getSessionIdFromCookie(req) {
  const cookies =
    req.headers.cookie || '';

  const match =
    cookies.match(
      /(?:^|;\s*)hac_session=([^;]+)/
    );

  if (!match) {
    return null;
  }

  try {
    const sessionId =
      decodeURIComponent(match[1]);

    if (
      !/^[a-f0-9]{64}$/i.test(sessionId)
    ) {
      return null;
    }

    return sessionId;

  } catch (error) {
    return null;
  }
}


/*
============================================================
SET HAC SESSION COOKIE
============================================================
*/

function setSessionCookie(res, sessionId) {
  const isProduction =
    !!process.env.VERCEL;

  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    `Max-Age=${SESSION_TTL}`,
    'Path=/',
    'HttpOnly'
  ];

  if (isProduction) {
    cookieParts.push('Secure');
    cookieParts.push('SameSite=None');
  } else {
    cookieParts.push('SameSite=Lax');
  }

  res.setHeader(
    'Set-Cookie',
    cookieParts.join('; ')
  );
}


/*
============================================================
CLEAR HAC SESSION COOKIE
============================================================
*/

function clearSessionCookie(res) {
  const isProduction =
    !!process.env.VERCEL;

  const cookieParts = [
    `${SESSION_COOKIE_NAME}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly'
  ];

  if (isProduction) {
    cookieParts.push('Secure');
    cookieParts.push('SameSite=None');
  } else {
    cookieParts.push('SameSite=Lax');
  }

  res.setHeader(
    'Set-Cookie',
    cookieParts.join('; ')
  );
}


/*
============================================================
CHECK REMEMBERED HAC SESSION
============================================================
*/

app.get('/api/session', async (req, res) => {

  /*
  IMPORTANT:
  Prevent browsers, Google Sites, Vercel, and proxies
  from caching this endpoint.

  This fixes the 304 responses we were seeing.
  */

  res.set({
    'Cache-Control':
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma':
      'no-cache',
    'Expires':
      '0',
    'Surrogate-Control':
      'no-store'
  });

  try {
    console.log('');
    console.log(
      '========== SESSION CHECK =========='
    );

    const sessionId =
      getSessionIdFromCookie(req);

    console.log(
      'HAC session cookie received:',
      sessionId ? 'YES' : 'NO'
    );

    /*
    * No cookie.
    */

    if (!sessionId) {
      console.log(
        'No valid HAC session cookie supplied.'
      );

      console.log(
        '=================================='
      );

      return res.status(200).json({
        authenticated: false,
        remembered: false
      });
    }

    /*
    * Find session in Redis.
    */

    const sessionKey =
      `hac:session:${sessionId}`;

    console.log(
      'Looking for session in Redis...'
    );

    const sessionData =
      await redis.get(sessionKey);

    console.log(
      'Session found in Redis:',
      sessionData ? 'YES' : 'NO'
    );

    /*
    * Session expired/deleted.
    */

    if (!sessionData) {
      console.log(
        'The Redis session was not found.'
      );

      clearSessionCookie(res);

      console.log(
        'Cleared expired HAC session cookie.'
      );

      console.log(
        '=================================='
      );

      return res.status(200).json({
        authenticated: false,
        remembered: false
      });
    }

    /*
    * Redis may return an object or JSON string.
    */

    let session;

    if (
      typeof sessionData === 'string'
    ) {
      try {
        session =
          JSON.parse(sessionData);

      } catch (parseError) {
        console.error(
          'Could not parse saved session:',
          parseError
        );

        clearSessionCookie(res);

        return res.status(500).json({
          authenticated: false,
          remembered: false,
          error:
            'Saved session data is invalid.'
        });
      }

    } else {
      session =
        sessionData;
    }

    /*
    * Update lastSeen.
    */

    session.lastSeen =
      new Date().toISOString();

    /*
    * Refresh Redis expiration.
    */

    await redis.set(
      sessionKey,
      JSON.stringify(session),
      {
        ex: SESSION_TTL
      }
    );

    /*
    * Refresh browser cookie.
    */

    setSessionCookie(
      res,
      sessionId
    );

    console.log(
      'Session restored successfully.'
    );

    console.log(
      'Session TTL refreshed for 30 days.'
    );

    console.log(
      '=================================='
    );

    return res.status(200).json({
      authenticated: true,
      remembered: true,

      username:
        session.username || null,

      classes:
        session.classes || [],

      lastSeen:
        session.lastSeen || null
    });

  } catch (error) {
    console.error(
      'Session check error:',
      error
    );

    return res.status(500).json({
      authenticated: false,
      remembered: false,
      error:
        'Could not check saved session.'
    });
  }
});


/*
============================================================
LOGOUT
============================================================
*/

app.post('/api/logout', async (req, res) => {
  try {
    const sessionId =
      getSessionIdFromCookie(req);

    console.log(
      'Logout request received.'
    );

    if (sessionId) {
      await redis.del(
        `hac:session:${sessionId}`
      );

      console.log(
        'HAC saved session deleted from Redis.'
      );
    } else {
      console.log(
        'No HAC session cookie found during logout.'
      );
    }

    clearSessionCookie(res);

    console.log(
      'HAC session cookie cleared.'
    );

    return res.json({
      success: true
    });

  } catch (error) {
    console.error(
      'Logout error:',
      error
    );

    clearSessionCookie(res);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


/*
============================================================
PARSE HAC GRADES
============================================================
*/

function parseGrades(bodyText) {
  const lines =
    bodyText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

  const classRegex =
    /^[A-Z]{2,6}\d{3,6}[A-Z]?\s*-\s*\d+\s+.+/;

  const gradeRegex =
    /Student Grades\s+([\d.]+)%/;

  const updatedRegex =
    /Last Updated:\s*([\d/]+)/;

  const classes = [];

  let current = null;

  for (const line of lines) {

    if (
      classRegex.test(line)
    ) {
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

    if (!current) {
      continue;
    }

    const gradeMatch =
      line.match(gradeRegex);

    if (gradeMatch) {
      current.grade =
        `${gradeMatch[1]}%`;

      continue;
    }

    const updatedMatch =
      line.match(updatedRegex);

    if (updatedMatch) {
      current.lastUpdated =
        updatedMatch[1];
    }
  }

  if (current) {
    classes.push(current);
  }

  return classes;
}


/*
============================================================
FIND LOCAL CHROME
============================================================
*/

function findLocalChrome() {
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',

    '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',

    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ];

  return chromePaths.find(
    filePath =>
      fs.existsSync(filePath)
  );
}


/*
============================================================
LAUNCH PUPPETEER
============================================================
*/

async function launchBrowser() {
  const puppeteerModule =
    await import('puppeteer-core');

  const puppeteer =
    puppeteerModule.default;

  /*
  * LOCAL MODE
  */

  if (!process.env.VERCEL) {
    const chromePath =
      findLocalChrome();

    if (!chromePath) {
      throw new Error(
        'Google Chrome could not be found on this Mac.'
      );
    }

    console.log(
      'Running in LOCAL mode.'
    );

    console.log(
      'Using Chrome:',
      chromePath
    );

    return puppeteer.launch({
      executablePath:
        chromePath,

      headless: true,

      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote'
      ],

      defaultViewport: {
        width: 1440,
        height: 900
      }
    });
  }

  /*
  * VERCEL MODE
  */

  const chromiumModule =
    await import(
      '@sparticuz/chromium-min'
    );

  const chromium =
    chromiumModule.default;

  console.log(
    'Running in VERCEL mode.'
  );

  console.log(
    'Preparing Sparticuz Chromium...'
  );

  const chromiumDirectory =
    path.join(
      process.cwd(),
      'public'
    );

  const requiredFiles = [
    'chromium.br',
    'fonts.tar.br',
    'swiftshader.tar.br',
    'al2023.tar.br'
  ];

  for (
    const file of requiredFiles
  ) {
    const filePath =
      path.join(
        chromiumDirectory,
        file
      );

    if (
      !fs.existsSync(filePath)
    ) {
      throw new Error(
        `Chromium file not found: ${filePath}`
      );
    }

    console.log(
      `Chromium file found: ${file}`
    );
  }

  console.log(
    'All Chromium files found successfully.'
  );

  const executablePath =
    await chromium.executablePath(
      chromiumDirectory
    );

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

    defaultViewport:
      chromium.defaultViewport,

    executablePath,

    headless:
      chromium.headless
  });
}


/*
============================================================
HAC LOGIN + GRADE SCRAPER
============================================================
*/

app.post('/api/grades', async (req, res) => {
  const {
    username,
    password
  } = req.body;

  if (
    !username ||
    !password
  ) {
    return res.status(400).json({
      error:
        'Username and password are required.'
    });
  }

  let browser = null;

  try {
    console.log('');
    console.log(
      '========================================'
    );
    console.log(
      'Starting HAC grade check...'
    );
    console.log(
      '========================================'
    );

    /*
    * Launch browser.
    */

    console.log(
      '1. Launching browser...'
    );

    browser =
      await launchBrowser();

    console.log(
      '2. Browser launched successfully.'
    );

    const page =
      await browser.newPage();

    await page.setViewport({
      width: 1440,
      height: 900
    });

    /*
    * HAC login page.
    */

    const loginUrl =
      'https://hac.friscoisd.org/HomeAccess/Account/LogOn?ReturnUrl=%2FHomeAccess%2FClasses%2FClasswork';

    console.log(
      '3. Loading HAC...'
    );

    await page.goto(
      loginUrl,
      {
        waitUntil:
          'networkidle2',

        timeout:
          30000
      }
    );

    console.log(
      '4. HAC login page loaded.'
    );

    /*
    * Login fields.
    */

    console.log(
      '5. Waiting for login fields...'
    );

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

    console.log(
      '6. Entering credentials...'
    );

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

    console.log(
      '7. Submitting HAC login...'
    );

    await Promise.all([
      page.click(
        'button[type="submit"], input[type="submit"]'
      ),

      page.waitForNavigation({
        waitUntil:
          'networkidle2',

        timeout:
          30000
      }).catch(() => null)
    ]);

    console.log(
      '8. Current HAC URL:',
      page.url()
    );

    /*
    * HAC login failed.
    */

    if (
      page.url().includes(
        '/Account/LogOn'
      )
    ) {
      console.log(
        'HAC redirected back to the login page.'
      );

      const diagnostic =
        await page.evaluate(() => {
          const bodyText =
            document.body?.innerText || '';

          const title =
            document.title || '';

          const errorElements = [
            ...document.querySelectorAll(
              '.validation-summary-errors, .field-validation-error, .error, .alert, [role="alert"]'
            )
          ];

          const errors =
            errorElements
              .map(
                element =>
                  element.innerText?.trim()
              )
              .filter(Boolean);

          return {
            title,

            errors,

            bodyPreview:
              bodyText
                .replace(
                  /\s+/g,
                  ' '
                )
                .trim()
                .slice(
                  0,
                  1500
                )
          };
        });

      console.log(
        'HAC diagnostic information:'
      );

      console.log(
        JSON.stringify(
          diagnostic,
          null,
          2
        )
      );

      return res.status(401).json({
        error:
          'HAC login was not successful.',

        diagnostic
      });
    }

    console.log(
      '9. HAC login successful.'
    );

    /*
    * Give HAC time to finish loading.
    */

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          3000
        )
    );

    console.log(
      '10. Looking for Classwork iframe...'
    );

    const iframeElement =
      await page.$(
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

    console.log(
      '11. Classwork iframe found.'
    );

    /*
    * Give iframe time to load.
    */

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          5000
        )
    );

    console.log(
      '12. Reading grade information...'
    );

    const bodyText =
      await frame.evaluate(() => {
        return document.body.innerText;
      });

    const classes =
      parseGrades(bodyText);

    console.log(
      `13. Parsed ${classes.length} classes.`
    );

    console.log(
      '14. HAC grade check completed.'
    );

    /*
    * Make sure grades were found.
    */

    if (
      classes.length === 0
    ) {
      console.log(
        'No classes were parsed from HAC.'
      );

      return res.status(500).json({
        error:
          'Could not find any grades on the HAC page.'
      });
    }

    /*
    ========================================================
    CREATE RANDOM SESSION ID
    ========================================================
    */

    const sessionId =
      crypto
        .randomBytes(32)
        .toString('hex');

    const now =
      new Date().toISOString();

    /*
    ========================================================
    SAVE SESSION DATA
    ========================================================
    */

    const sessionData = {
      username,

      classes,

      createdAt:
        now,

      lastSeen:
        now
    };

    await redis.set(
      `hac:session:${sessionId}`,

      JSON.stringify(
        sessionData
      ),

      {
        ex:
          SESSION_TTL
      }
    );

    console.log(
      '15. Device session saved to Redis.'
    );

    /*
    ========================================================
    SAVE SESSION IN BROWSER COOKIE
    ========================================================
    */

    setSessionCookie(
      res,
      sessionId
    );

    console.log(
      '16. HAC session cookie created.'
    );

    console.log(
      'Session cookie name:',
      SESSION_COOKIE_NAME
    );

    console.log(
      'Session expires in:',
      '30 days'
    );

    /*
    ========================================================
    RETURN GRADES
    ========================================================
    */

    return res.json({
      classes,

      remembered:
        true
    });

  } catch (error) {
    console.error('');
    console.error(
      '========================================'
    );

    console.error(
      'HAC scrape error'
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

    return res.status(500).json({
      error:
        'Failed to communicate with HAC.',

      details:
        error.message
    });

  } finally {
    if (browser) {
      await browser
        .close()
        .catch(() => {});
    }
  }
});


/*
============================================================
START LOCAL SERVER
============================================================
*/

if (
  require.main === module
) {
  const PORT =
    process.env.PORT || 3000;

  app.listen(
    PORT,
    () => {
      console.log(
        '========================================'
      );

      console.log(
        'HAC Grade Viewer - LOCAL SERVER'
      );

      console.log(
        '========================================'
      );

      console.log('');

      console.log(
        `Server running at: http://localhost:${PORT}`
      );

      console.log('');

      console.log(
        'Redis test:'
      );

      console.log(
        `http://localhost:${PORT}/api/redis-test`
      );

      console.log('');

      console.log(
        'Cookie test:'
      );

      console.log(
        `http://localhost:${PORT}/api/cookie-test`
      );

      console.log('');

      console.log(
        'Session system:'
      );

      console.log(
        'HTTP-only hac_session cookie'
      );

      console.log('');

      console.log(
        'Open the address above in your browser.'
      );

      console.log(
        'Press Ctrl+C to stop the server.'
      );

      console.log('');
    }
  );
}


module.exports = app;