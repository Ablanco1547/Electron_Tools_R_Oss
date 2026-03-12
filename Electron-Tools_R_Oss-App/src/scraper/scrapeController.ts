import type { Request, Response } from 'express';
import { runWithPage } from './puppeteerClient';
import { draftKingsScraper, detectDraftKingsType } from './draftKingsScraper';
import { exampleSiteScraper } from './exampleScraper';
import { oddsCheckerScraper } from './oddsCheckerScraper';

function getDomain(url: string) {
    const { hostname } = new URL(url);
    let domain = hostname.toLowerCase().replace(/^www\./i, '');

    if (domain.endsWith('.draftkings.com')) {
        domain = 'draftkings.com';
    }

    return domain;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeDefault(page: any, { url }: { url: string }) {
    const paragraphs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('p')).map((p) => (p as HTMLElement).innerText),
    );
    return { site: 'default', type: 'paragraphs', url, paragraphs };
}

const SITE_SCRAPERS: Record<string, any> = {
    'draftkings.com': draftKingsScraper,
    'example.com': exampleSiteScraper,
    'oddschecker.com': oddsCheckerScraper,
};

const DETECTION_FUNCTIONS: Record<string, any> = {
    'draftkings.com': detectDraftKingsType,
};

// Express route handler for POST /scraper/scrape
// Expects body: { url: string, maxOdds: number, order: string, oddsType: string, options?: object }
export async function scrapeWebsite(req: Request, res: Response) {
    try {
        const { url, maxOdds, order, oddsType, options = {} } = (req.body || {}) as any;

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'A valid "url" field is required.' });
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
                    ? await detectFn(page, { url, maxOdds, order, oddsType, draftKingsNetworkData, options })
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
                draftKingsNetworkData,
                ...(options as any),
            });

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
            }

            return result;
        });

        return res.json({ data });
    } catch (error: any) {
        console.error('Error scraping website:', error);
        return res.status(500).json({ error: 'Failed to scrape website.' });
    }
}
