import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

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

// Persistent profile so cookies set by anti-bot challenges (e.g. firewall
// clearance cookies) survive between scrapes instead of every run looking
// like a brand-new visitor.
function getProfileDir(): string {
    return path.join(app.getPath('userData'), 'scraper-profile');
}

// A persistent profile can only be opened by one browser at a time, so
// serialize jobs instead of letting concurrent requests collide on the lock.
let jobQueue: Promise<unknown> = Promise.resolve();

// Lightweight wrapper to run a job with a fresh Puppeteer page.
// This is adapted from Api_Tools_R_Oss/models/misc/puppeteerClient.js
// so the Electron app can run the same scraping logic locally.
export function runWithPage<T>(job: (page: any) => Promise<T>, launchOptions: Record<string, any> = {}): Promise<T> {
    const run = jobQueue.then(() => runJob(job, launchOptions));
    jobQueue = run.catch((): void => undefined);
    return run;
}

async function runJob<T>(job: (page: any) => Promise<T>, launchOptions: Record<string, any>): Promise<T> {
    const { args = [], ignoreDefaultArgs, ...rest } = launchOptions;

    const executablePath = findBrowserExecutable();

    if (!executablePath) {
        throw new Error(
            'No compatible Chrome/Edge browser found on this machine. Please install Google Chrome or Microsoft Edge.',
        );
    }

    // Launch the system-installed Chrome/Edge (not a Puppeteer-managed copy)
    // and keep its fingerprint close to a normal user session: real
    // user-agent, real window size, GPU enabled, persistent profile.
    const browser = await puppeteer.launch({
        headless: false,
        executablePath,
        userDataDir: getProfileDir(),
        // Use the real window size so innerHeight and screen.height stay consistent.
        defaultViewport: null,
        // Try to reduce obvious automation signals.
        ignoreDefaultArgs: ignoreDefaultArgs ?? ['--enable-automation'],
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled', ...args],
        ...rest,
    });

    // Reuse the tab Chrome opens on startup instead of leaving a stray blank one.
    const [existingPage] = await browser.pages();
    const page = existingPage ?? (await browser.newPage());

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

    // No user-agent override on purpose: the installed browser's own UA
    // matches its Sec-CH-UA client hints and navigator.userAgent, and a
    // mismatch between those is a common bot-detection signal.

    try {
        return await job(page);

    } finally {
        await browser.close();
    }
}
