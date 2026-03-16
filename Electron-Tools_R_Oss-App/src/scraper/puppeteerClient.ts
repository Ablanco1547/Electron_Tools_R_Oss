import puppeteer from 'puppeteer';

// Lightweight wrapper to run a job with a fresh Puppeteer page.
// This is adapted from Api_Tools_R_Oss/models/misc/puppeteerClient.js
// so the Electron app can run the same scraping logic locally.
export async function runWithPage<T>(job: (page: any) => Promise<T>, launchOptions: Record<string, any> = {}): Promise<T> {
    const { args = [], ...rest } = launchOptions;

    // Force Puppeteer to run in headless mode. We keep the
    // boolean type (to satisfy the current Puppeteer typings)
    // and rely on the explicit `--headless=new` flag in args
    // to select the new headless implementation.
    const browser = await puppeteer.launch({
        headless: false,
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
