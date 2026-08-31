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

    return domain;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
                                    betOnlineNetworkData.contestResponses.push({
                                        url: responseUrl,
                                        json,
                                    });

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

                console.log('BetOnline: first load', { url });
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                console.log('BetOnline: first load done, waiting for network activity');
                await sleep(4000);

                try {
                    const currentUrl = page.url();
                    const title = await page.title();
                    console.log('BetOnline: after first load page state', { currentUrl, title });

                    if (title && title.toLowerCase().includes('internal error')) {
                        const html = await page.content();
                        console.warn('BetOnline: firewall/internal error detected after first load', {
                            currentUrl,
                            title,
                            bodySnippet: String(html).slice(0, 500),
                        });
                    }
                } catch (stateErr: any) {
                    console.warn('BetOnline: error while logging page state after first load', stateErr?.message || stateErr);
                }

                // Only start capturing contests API responses after the reload, so that
                // each contest set is captured once (from the final page state) instead
                // of duplicating first-load and reload traffic.
                page.on('response', responseHandler);

                console.log('BetOnline: reloading page');
                await page
                    .reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
                    .catch((err: any) => {
                        console.warn('BetOnline reload error:', err?.message || err);
                    });
                console.log('BetOnline: reload done, waiting for network activity');
                await sleep(4000);

                try {
                    const currentUrl = page.url();
                    const title = await page.title();
                    console.log('BetOnline: after reload page state', { currentUrl, title });

                    if (title && title.toLowerCase().includes('internal error')) {
                        const html = await page.content();
                        console.warn('BetOnline: firewall/internal error detected after reload', {
                            currentUrl,
                            title,
                            bodySnippet: String(html).slice(0, 500),
                        });
                    }
                } catch (stateErr: any) {
                    console.warn('BetOnline: error while logging page state after reload', stateErr?.message || stateErr);
                }

                page.off('response', responseHandler);
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
                result.contests = mergeContestsIntoSingleDocument(result.contests, 'DraftKings Matchups');
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
        return res.status(500).json({
            error: 'Failed to scrape website.',
            code: 'SCRAPER_INTERNAL_ERROR',
            details: {
                name: errorInfo.name,
                message: errorInfo.message,
            },
        });
    }
}
