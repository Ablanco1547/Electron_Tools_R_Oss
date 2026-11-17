import type { Request, Response } from 'express';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { runWithPage } from './puppeteerClient';
import { draftKingsScraper, detectDraftKingsType } from './draftKingsScraper';
import { betOnlineScraper, detectBetOnlineType } from './betOnlineScraper';
import { exampleSiteScraper } from './exampleScraper';
import { oddsCheckerScraper } from './oddsCheckerScraper';
import { bet487Scraper, detectBet487Type } from './bet487Scraper';
import { sports411Scraper, detectSports411Type } from './sports411Scraper';
import * as scraperMiscFns from './scraperMiscFunctions';

function getDomain(url: string) {
    const { hostname } = new URL(url);
    let domain = hostname.toLowerCase().replace(/^www\./i, '');

    if (domain.endsWith('.draftkings.com')) {
        domain = 'draftkings.com';
    }

    if (domain === 'betonline.ag' || domain.endsWith('.betonline.ag')) {
        domain = 'betonline.ag';
    }

    if (domain === 'sportsbetting.ag' || domain.endsWith('.sportsbetting.ag')) {
        domain = 'sportsbetting.ag';
    }

    if (domain === 'bet487.org' || domain.endsWith('.bet487.org')) {
        domain = 'bet487.org';
    }

    if (domain === 'sports411.ag' || domain.endsWith('.sports411.ag')) {
        domain = 'sports411.ag';
    }

    if (domain === 'sportsbook.ag' || domain.endsWith('.sportsbook.ag')) {
        domain = 'sportsbook.ag';
    }

    return domain;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Errors thrown when BetOnline's firewall blocks us start with this prefix so
// callers can skip immediate retries (which only prolong the block).
export const BETONLINE_BLOCKED_ERROR_PREFIX = 'BetOnline blocked:';

// Page titles seen on firewall / anti-bot challenge pages.
function isBetOnlineBlockTitle(title: string) {
    const t = title.toLowerCase();
    return ['internal error', 'just a moment', 'attention required', 'access denied', 'request rejected', 'forbidden'].some(
        (marker) => t.includes(marker),
    );
}

// Combines every contest/list scraped in a single request into one merged
// document so it can be viewed/downloaded as a single list instead of many.
// Each original list becomes a header row (its title/subtitle, no odds)
// followed by its own contestant rows, so the merged document reads as
// repeated "Title / contestant / contestant" groups.
function mergeContestsIntoSingleDocument(contests: any[], mergedTitle: string) {
    if (!Array.isArray(contests) || contests.length === 0) {
        return contests;
    }

    let rotation = scraperMiscFns.generateRotationNumber();
    const contestants: any[] = [];

    for (const contest of contests) {
        const contestantList = Array.isArray(contest?.contestants) ? contest.contestants : [];

        if (!contestantList.length) {
            continue;
        }

        const contestLabel = contest?.subtitle ? `${contest.title} - ${contest.subtitle}` : contest?.title;

        contestants.push({ name: contestLabel || 'Untitled', odds: '', rotation: rotation++ });

        for (const contestant of contestantList) {
            contestants.push({ ...contestant, rotation: rotation++ });
        }
    }

    return [
        {
            title: mergedTitle,
            subtitle: '',
            contestants,
        },
    ];
}

async function scrapeDefault(page: any, { url }: { url: string }) {
    const paragraphs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('p')).map((p) => (p as HTMLElement).innerText),
    );
    return { site: 'default', type: 'paragraphs', url, paragraphs };
}

async function authenticateSports411(page: any, options: any = {}) {
    const sports411Auth = options?.sports411Auth || {};
    const username = sports411Auth.username || options?.username || '';
    const password = sports411Auth.password || options?.password || '';

    if (!username || !password) {
        return;
    }

    // TODO: implement the Sports411 login flow here.
    // Suggested flow:
    // 1. Navigate to the Sports411 login page or homepage.
    // 2. Fill the username and password fields.
    // 3. Submit the form and wait for the authenticated session to settle.
    // 4. Return once the site is ready for the target contest URL.
    void page;
    void username;
    void password;
}

const SITE_SCRAPERS: Record<string, any> = {
    'draftkings.com': draftKingsScraper,
    'betonline.ag': betOnlineScraper,
    'sportsbetting.ag': betOnlineScraper,
    'bet487.org': bet487Scraper,
    'sports411.ag': sports411Scraper,
    'example.com': exampleSiteScraper,
    'oddschecker.com': oddsCheckerScraper,
};

const DETECTION_FUNCTIONS: Record<string, any> = {
    'draftkings.com': detectDraftKingsType,
    'betonline.ag': detectBetOnlineType,
    'sportsbetting.ag': detectBetOnlineType,
    'bet487.org': detectBet487Type,
    'sports411.ag': detectSports411Type,
};

function logErrorToFile(errorInfo: { name: string; message: string; stack: string | null }, context: Record<string, unknown> = {}) {
    try {
        const userDataPath = app.getPath('userData');
        const logsDir = path.join(userDataPath, 'logs');
        const logFile = path.join(logsDir, 'scraper-errors.log');

        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        const entry = {
            timestamp: new Date().toISOString(),
            error: errorInfo,
            context,
        };

        fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (fileErr) {
        // As a fallback, still log to console if file logging fails.
        // eslint-disable-next-line no-console
        console.error('Failed to write scraper error log file:', fileErr);
    }
}

// Express route handler for POST /scraper/scrape
// Expects body: { url: string, maxOdds: number, order: string, oddsType: string, options?: object }
export async function scrapeWebsite(req: Request, res: Response) {
    try {
        const { url, maxOdds, order, oddsType, scrapeMode = 'contests', options = {} } = (req.body || {}) as any;

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'A valid "url" field is required.' });
        }

        if (!['contests', 'matchups'].includes(scrapeMode)) {
            return res.status(400).json({
                error: 'A valid "scrapeMode" field is required. Must be "contests" or "matchups".',
            });
        }

        if (maxOdds === undefined || typeof maxOdds !== 'number') {
            return res.status(400).json({ error: 'A valid "maxOdds" field (number) is required.' });
        }

        if (!order || typeof order !== 'string') {
            return res.status(400).json({ error: 'A valid "order" field is required (e.g., "asc" or "desc").' });
        }

        if (!oddsType || !['average', 'highest', 'lowest'].includes(oddsType)) {
            return res.status(400).json({
                error: 'A valid "oddsType" field is required. Must be "average", "highest", or "lowest".',
            });
        }

        const domain = getDomain(url);
        const siteScraper = SITE_SCRAPERS[domain];

        console.log('Scraper starting', { url, domain, maxOdds, order, oddsType });

        const data = await runWithPage(async (page) => {
            let draftKingsNetworkData: any = null;
            let betOnlineNetworkData: any = null;
            let sports411NetworkData: any = null;

            if (domain === 'draftkings.com') {
                console.log('DraftKings: setting up response listener');
                let marketsHandled = false;

                const responseHandler = async (response: any) => {
                    try {
                        if (marketsHandled) return;

                        const request = response.request();
                        const responseUrl = response.url();
                        const method = request.method();

                        if (responseUrl.includes('markets')) {
                            console.log('DraftKings markets-related response seen:', {
                                url: responseUrl,
                                method,
                            });
                        }

                        if (method === 'GET' && responseUrl.includes('markets?isBatchable')) {
                            console.log('DraftKings target markets?isBatchable response matched:', {
                                url: responseUrl,
                                method,
                            });
                            marketsHandled = true;

                            const marketsJson = await response.json().catch((err: any): null => {
                                console.warn('Error parsing DraftKings markets JSON:', err?.message || err);
                                return null;
                            });

                            if (marketsJson) {
                                draftKingsNetworkData = {
                                    marketsUrl: responseUrl,
                                    marketsJson,
                                };

                                try {
                                    const rootKeys = marketsJson && typeof marketsJson === 'object' ? Object.keys(marketsJson) : [];
                                    console.log('DraftKings markets?isBatchable captured', {
                                        marketsUrl: draftKingsNetworkData.marketsUrl,
                                        rootKeys,
                                        isArray: Array.isArray(marketsJson),
                                        length: Array.isArray(marketsJson) ? marketsJson.length : undefined,
                                    });
                                } catch (logErr: any) {
                                    console.warn('Error logging DraftKings markets JSON summary:', logErr?.message || logErr);
                                }
                            }
                        }
                    } catch (err: any) {
                        console.warn('DraftKings response handler error:', err?.message || err);
                    }
                };

                page.on('response', responseHandler);

                console.log('DraftKings: first load', { url });
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                console.log('DraftKings: first load done, waiting for network activity');
                await sleep(4000);

                console.log('DraftKings: reloading page');
                await page
                    .reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
                    .catch((err: any) => {
                        console.warn('DraftKings reload error:', err?.message || err);
                    });
                console.log('DraftKings: reload done, waiting for network activity');
                await sleep(4000);

                page.off('response', responseHandler);
                console.log('DraftKings: response listener removed');
            } else if (domain === 'betonline.ag' || domain === 'sportsbetting.ag') {
                console.log('BetOnline: setting up response listener');

                betOnlineNetworkData = {
                    contestResponses: [] as any[],
                };
                let lastContestResponseAt = 0;

                const responseHandler = async (response: any) => {
                    try {
                        const request = response.request();
                        const responseUrl = response.url();
                        const method = request.method();

                        const status = typeof response.status === 'function' ? response.status() : undefined;

                        if (responseUrl.includes('get-contests-by-contest-type2')) {
                            console.log('BetOnline get-contests-by-contest-type2 response seen:', {
                                url: responseUrl,
                                method,
                                status,
                            });

                            // The contests API is returning JSON on POST (and may use OPTIONS
                            // for preflight), so capture any successful 2xx JSON response
                            // regardless of HTTP method.
                            if (status && status >= 200 && status < 300) {
                                const json = await response.json().catch((err: any): null => {
                                    console.warn('Error parsing BetOnline contests JSON:', err?.message || err);
                                    return null;
                                });

                                if (json) {
                                    // The same contest can be requested more than once (e.g. on a
                                    // fallback reload); keep only the latest response per request.
                                    const postData = typeof request.postData === 'function' ? request.postData() || '' : '';
                                    const key = `${responseUrl}|${postData}`;
                                    const existingIndex = betOnlineNetworkData.contestResponses.findIndex(
                                        (entry: any) => entry.key === key,
                                    );
                                    const entry = { key, url: responseUrl, json };

                                    if (existingIndex >= 0) {
                                        betOnlineNetworkData.contestResponses[existingIndex] = entry;
                                    } else {
                                        betOnlineNetworkData.contestResponses.push(entry);
                                    }
                                    lastContestResponseAt = Date.now();

                                    try {
                                        const summary =
                                            json && typeof json === 'object'
                                                ? {
                                                    rootKeys: Object.keys(json),
                                                    isArray: Array.isArray(json),
                                                    length: Array.isArray(json) ? json.length : undefined,
                                                }
                                                : { isArray: Array.isArray(json) };

                                        console.log('BetOnline contests response captured', {
                                            url: responseUrl,
                                            totalCaptured: betOnlineNetworkData.contestResponses.length,
                                            summary,
                                        });
                                    } catch (logErr: any) {
                                        console.warn(
                                            'Error logging BetOnline contests JSON summary:',
                                            logErr?.message || logErr,
                                        );
                                    }
                                }
                            }
                        }
                    } catch (err: any) {
                        console.warn('BetOnline response handler error:', err?.message || err);
                    }
                };

                // Randomized, human-ish waits instead of fixed robotic timings.
                const humanPause = (minMs: number, maxMs: number) =>
                    sleep(minMs + Math.floor(Math.random() * (maxMs - minMs)));

                const getPageState = async () => {
                    const currentUrl = page.url();
                    const title = String((await page.title().catch((): string => '')) || '');
                    return { currentUrl, title, blocked: isBetOnlineBlockTitle(title) };
                };

                // Wait out any firewall/JS challenge instead of reloading on top of it.
                const waitForChallengeToClear = async (label: string, maxWaitMs: number) => {
                    const deadline = Date.now() + maxWaitMs;
                    let state = await getPageState();
                    while (state.blocked && Date.now() < deadline) {
                        await sleep(1000);
                        state = await getPageState();
                    }
                    console.log(`BetOnline: page state after ${label}`, state);
                    return state;
                };

                // Wait until contests responses stop arriving (or a hard cap is hit).
                const waitForContestsToSettle = async (quietMs: number, maxWaitMs: number) => {
                    const start = Date.now();
                    while (Date.now() - start < maxWaitMs) {
                        const lastActivity = lastContestResponseAt || start;
                        if (Date.now() - lastActivity >= quietMs) return;
                        await sleep(500);
                    }
                };

                const scrollLikeAUser = async () => {
                    try {
                        await page.mouse.move(300 + Math.random() * 600, 200 + Math.random() * 300, { steps: 12 });
                        for (let i = 0; i < 3; i++) {
                            await page.mouse.wheel({ deltaY: 250 + Math.random() * 250 });
                            await humanPause(300, 800);
                        }
                    } catch {
                        // Non-fatal; interaction is only to look less robotic.
                    }
                };

                // Listen from the very first load so we do not need a forced reload
                // just to capture the contests traffic. Duplicates are collapsed in
                // the handler.
                page.on('response', responseHandler);

                try {
                    console.log('BetOnline: first load', { url });
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

                    let state = await waitForChallengeToClear('first load', 30000);

                    if (!state.blocked) {
                        await humanPause(1500, 3000);
                        await scrollLikeAUser();
                        await waitForContestsToSettle(3000, 20000);

                        // Fallback: only reload if the first load produced no contests
                        // traffic at all (and we are not looking at a block page).
                        if (betOnlineNetworkData.contestResponses.length === 0) {
                            console.log('BetOnline: no contests captured on first load, reloading once');
                            await humanPause(2000, 4000);
                            await page
                                .reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
                                .catch((err: any) => {
                                    console.warn('BetOnline reload error:', err?.message || err);
                                });
                            state = await waitForChallengeToClear('reload', 30000);
                            if (!state.blocked) {
                                await humanPause(1500, 3000);
                                await waitForContestsToSettle(3000, 20000);
                            }
                        }
                    }

                    if (state.blocked && betOnlineNetworkData.contestResponses.length === 0) {
                        const html = await page.content().catch((): string => '');
                        console.warn('BetOnline: firewall/block page detected', {
                            ...state,
                            bodySnippet: String(html).slice(0, 500),
                        });
                        throw new Error(
                            `${BETONLINE_BLOCKED_ERROR_PREFIX} the site's firewall blocked the scraper (page title: "${state.title}"). ` +
                                'Wait a few minutes before trying again.',
                        );
                    }
                } finally {
                    page.off('response', responseHandler);
                }

                console.log('BetOnline: response listener removed', {
                    totalContestResponses: betOnlineNetworkData.contestResponses.length,
                });
            } else if (domain === 'sports411.ag') {
                console.log('Sports411: setting up response listener');

                let scheduleHandled = false;

                const responseHandler = async (response: any) => {
                    try {
                        if (scheduleHandled) return;

                        const request = response.request();
                        const responseUrl = response.url();
                        const method = request.method();
                        const postData = typeof request.postData === 'function' ? request.postData() : '';

                        const matchesScheduleRequest =
                            responseUrl.includes('GetSchedule') ||
                            postData?.includes('GetSchedule') ||
                            request.url().includes('GetSchedule');

                        if (!matchesScheduleRequest) {
                            return;
                        }

                        console.log('Sports411 GetSchedule response seen:', {
                            url: responseUrl,
                            method,
                        });

                        scheduleHandled = true;

                        const scheduleJson = await response.json().catch((err: any): null => {
                            console.warn('Error parsing Sports411 GetSchedule JSON:', err?.message || err);
                            return null;
                        });

                        if (scheduleJson) {
                            sports411NetworkData = {
                                scheduleUrl: responseUrl,
                                scheduleJson,
                            };

                            try {
                                const rootKeys = scheduleJson && typeof scheduleJson === 'object' ? Object.keys(scheduleJson) : [];
                                console.log('Sports411 GetSchedule captured', {
                                    scheduleUrl: sports411NetworkData.scheduleUrl,
                                    rootKeys,
                                });
                            } catch (logErr: any) {
                                console.warn('Error logging Sports411 GetSchedule JSON summary:', logErr?.message || logErr);
                            }
                        }
                    } catch (err: any) {
                        console.warn('Sports411 response handler error:', err?.message || err);
                    }
                };

                page.on('response', responseHandler);

                const sports411BaseUrl = new URL(url).origin;
                console.log('Sports411: first load', { sports411BaseUrl });
                await page.goto(sports411BaseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                console.log('Sports411: first load done, waiting for authentication hook');
                await authenticateSports411(page, options);
                console.log('Sports411: auth hook complete, waiting for page to settle');
                await sleep(4000);

                console.log('Sports411: navigating to requested URL', { url });
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                console.log('Sports411: target navigation done, waiting for network activity');
                await sleep(4000);

                page.off('response', responseHandler);
                console.log('Sports411: response listener removed');
            } else {
                console.log('Generic site: navigating to URL', { url });

                if (domain === 'oddschecker.com') {
                    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
                    console.log('OddsChecker: navigation (networkidle2) done');
                } else {
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    console.log('Generic site: navigation done');
                }
            }

            let type: string;

            if (siteScraper) {
                const detectFn = DETECTION_FUNCTIONS[domain];
                type = detectFn
                    ? await detectFn(page, {
                        url,
                        maxOdds,
                        order,
                        oddsType,
                        draftKingsNetworkData,
                        betOnlineNetworkData,
                        sports411NetworkData,
                        options,
                    })
                    : Object.keys(siteScraper)[0];
                console.log('Scraper type detected/selected', { domain, type });
            } else {
                console.log('No specific scraper for domain, using default handler', { domain });
                return scrapeDefault(page, { url, ...(options as any) });
            }

            const scraperFn = siteScraper[type];
            if (!scraperFn) {
                throw new Error(`Detected type "${type}" but no scraper found.`);
            }

            const result = await scraperFn(page, {
                url,
                maxOdds,
                order,
                oddsType,
                scrapeMode,
                draftKingsNetworkData,
                betOnlineNetworkData,
                sports411NetworkData,
                ...(options as any),
            });

            // Matchups mode: sites can opt in to combining every list scraped
            // in this request into a single merged document. Only DraftKings
            // does this today; add more domains here as they get their own
            // matchups logic.
            if (scrapeMode === 'matchups' && domain === 'draftkings.com' && Array.isArray(result?.contests)) {
                const marketTypeName = result?.marketsJson?.markets?.[0]?.marketType?.name;
                const mergedTitle = typeof marketTypeName === 'string' && marketTypeName.trim() ? marketTypeName.trim() : 'DraftKings Matchups';
                result.contests = mergeContestsIntoSingleDocument(result.contests, mergedTitle);
            }

            if (domain === 'draftkings.com') {
                try {
                    console.log('DraftKings scraper result summary:', {
                        detectedType: type,
                        hasMarketsJson: !!result?.marketsJson,
                        marketsUrl: result?.marketsUrl || null,
                    });
                } catch (logErr: any) {
                    console.warn('Error logging DraftKings scraper result summary:', logErr?.message || logErr);
                }
            } else if (domain === 'betonline.ag') {
                try {
                    console.log('BetOnline scraper result summary:', {
                        detectedType: type,
                        totalContestResponses: betOnlineNetworkData?.contestResponses?.length || 0,
                    });
                } catch (logErr: any) {
                    console.warn('Error logging BetOnline scraper result summary:', logErr?.message || logErr);
                }
            } else if (domain === 'sports411.ag') {
                try {
                    console.log('Sports411 scraper result summary:', {
                        detectedType: type,
                        hasScheduleJson: !!result?.scheduleJson,
                        scheduleUrl: result?.scheduleUrl || null,
                    });
                } catch (logErr: any) {
                    console.warn('Error logging Sports411 scraper result summary:', logErr?.message || logErr);
                }
            }

            return result;
        });

        return res.json({ data });
    } catch (error: any) {
        // Option 1 + 4: richer diagnostics and log file for users to send.
        const errorInfo = {
            name: error?.name ?? 'Error',
            message: error?.message ?? String(error),
            stack: error?.stack ?? null,
        };

        const context = {
            url: (req.body as any)?.url,
            maxOdds: (req.body as any)?.maxOdds,
            order: (req.body as any)?.order,
            oddsType: (req.body as any)?.oddsType,
            scrapeMode: (req.body as any)?.scrapeMode,
        };

        // Log structured details to console and to a file under the
        // app's userData path so users can send you the log.
        console.error('Error scraping website (detailed):', { errorInfo, context });
        logErrorToFile(errorInfo, context);

        // Also surface basic details back to the caller so the renderer
        // can show or log them while still treating this as a 500.
        const isBlocked = String(errorInfo.message).startsWith(BETONLINE_BLOCKED_ERROR_PREFIX);

        return res.status(500).json({
            error: isBlocked ? errorInfo.message : 'Failed to scrape website.',
            code: isBlocked ? 'SITE_BLOCKED' : 'SCRAPER_INTERNAL_ERROR',
            details: {
                name: errorInfo.name,
                message: errorInfo.message,
            },
        });
    }
}
