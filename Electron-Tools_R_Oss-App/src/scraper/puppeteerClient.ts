import puppeteer from 'puppeteer';
import fs from 'node:fs';

function findBrowserExecutable(): string | undefined {
    // Allow overriding via environment variable if needed.
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    if (process.platform === 'win32') {
        const candidates = [
            'C:/Program Files/Google/Chrome/Application/chrome.exe',
            'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
            'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        ];

        for (const p of candidates) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
    }

    return undefined;
}

// Lightweight wrapper to run a job with a fresh Puppeteer page.
// This is adapted from Api_Tools_R_Oss/models/misc/puppeteerClient.js
// so the Electron app can run the same scraping logic locally.
export async function runWithPage<T>(job: (page: any) => Promise<T>, launchOptions: Record<string, any> = {}): Promise<T> {
    const { args = [], ...rest } = launchOptions;

    const executablePath = findBrowserExecutable();

    if (!executablePath) {
        throw new Error(
            'No compatible Chrome/Edge browser found on this machine. Please install Google Chrome or Microsoft Edge.',
        );
    }

    // Force Puppeteer to run in headless mode and target the
    // system-installed Chrome/Edge instead of a managed copy
    // in the Puppeteer cache (which does not exist on end users).
    const browser = await puppeteer.launch({
        headless: true,
        executablePath,
        defaultViewport: { width: 2000, height: 9998 },
        args: ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox', ...args],
        ...rest,
    });

    const page = await browser.newPage();

    try {
        // Increase navigation timeouts a bit to handle slower, script-heavy sites.
        if (typeof page.setDefaultNavigationTimeout === 'function') {
            page.setDefaultNavigationTimeout(60000);
        }
        if (typeof page.setDefaultTimeout === 'function') {
            page.setDefaultTimeout(60000);
        }
    } catch {
        // Non-fatal; older Puppeteer versions may not support these.
    }

    // Match the original user-agent intent.
    // setUserAgent is deprecated in newer Puppeteer versions, so prefer
    // setting the header directly instead.
    try {
        await page.setExtraHTTPHeaders({
            'user-agent':
                '(Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
        });
    } catch {
        // Non-fatal; scraping can still proceed with the default headers.
    }

    try {
        return await job(page);
    } finally {
        await browser.close();
    }
}
