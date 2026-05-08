import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { scrapeWebsite } from './scraper/scrapeController';
import * as scraperMiscFns from './scraper/scraperMiscFunctions';
import {
    getContestantComparisonKey,
    normalizeContestantDisplayName,
} from './scraper/contestantAliases';

type OddsType = 'average' | 'highest' | 'lowest';

interface BulkScrapeRequestBody {
    links?: string | string[];
    maxOdds?: number;
    order?: string;
    oddsType?: OddsType;
    timeoutMs?: number;
    retryCount?: number;
    csvContent?: string;
    options?: Record<string, unknown>;
}

interface NormalizedParticipant {
    name: string;
    odds: string;
}

interface NormalizedOddsItem {
    website: string;
    title: string;
    participants: NormalizedParticipant[];
    sourceUrl: string;
}

interface AggregatedContestant {
    name: string;
    odds: string;
    rotation: number;
}

interface AggregatedContest {
    title: string;
    contestants: AggregatedContestant[];
}

interface AggregatedSummaryObject {
    website: 'aggregate';
    title: 'Highest' | 'Lowest' | 'Average';
    contests: AggregatedContest[];
}

interface CsvParseResult {
    objects: NormalizedOddsItem[];
    errors: string[];
}

const SUPPORTED_WEBSITES = new Set([
    'draftkings.com',
    'betonline.ag',
    'sportsbetting.ag',
    'bet487.org',
    'sports411.ag',
    'oddschecker.com',
    'example.com',
]);

const DEFAULT_TIMEOUT_MS = 120000;
const MIN_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 300000;
const DEFAULT_RETRY_COUNT = 1;
const MAX_RETRY_COUNT = 3;

function getDomain(url: string): string | null {
    try {
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
    } catch {
        return null;
    }
}

function normalizeContest(contest: unknown): { title: string; participants: NormalizedParticipant[] } | null {
    if (!contest || typeof contest !== 'object') {
        return null;
    }

    const rawContest = contest as Record<string, unknown>;
    const title = typeof rawContest.title === 'string' ? rawContest.title : 'Unknown contest';
    const rawParticipants = Array.isArray(rawContest.contestants) ? rawContest.contestants : [];

    const participants: NormalizedParticipant[] = rawParticipants
        .map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }

            const participant = entry as Record<string, unknown>;
            const name = typeof participant.name === 'string' ? participant.name : 'Unknown participant';
            const oddsValue =
                typeof participant.odds === 'string' || typeof participant.odds === 'number'
                    ? participant.odds
                    : typeof participant.Odds === 'string' || typeof participant.Odds === 'number'
                        ? participant.Odds
                        : null;

            if (oddsValue === null) {
                return null;
            }

            return {
                name: normalizeContestantDisplayName(name),
                odds: String(oddsValue),
            };
        })
        .filter((participant): participant is NormalizedParticipant => participant !== null);

    return { title, participants };
}

function normalizeScrapedData(sourceUrl: string, website: string, scrapedData: unknown): NormalizedOddsItem[] {
    if (!scrapedData || typeof scrapedData !== 'object') {
        return [];
    }

    const rawData = scrapedData as Record<string, unknown>;
    const detectedWebsite =
        typeof rawData.site === 'string' && rawData.site.length > 0
            ? rawData.site
            : website;

    const contests = Array.isArray(rawData.contests)
        ? rawData.contests
        : [];

    const normalizedFromContests = contests
        .map((contest) => normalizeContest(contest))
        .filter((contest): contest is { title: string; participants: NormalizedParticipant[] } => contest !== null)
        .map((contest) => ({
            website: detectedWebsite,
            title: contest.title,
            participants: contest.participants,
            sourceUrl,
        }));

    if (normalizedFromContests.length > 0) {
        return normalizedFromContests;
    }

    const singleContest = normalizeContest(rawData);
    if (singleContest) {
        return [{
            website: detectedWebsite,
            title: singleContest.title,
            participants: singleContest.participants,
            sourceUrl,
        }];
    }

    return [];
}

function parseOddsNumber(value: string): number | null {
    const trimmed = value.trim();
    const match = trimmed.match(/[+-]?\d+/);
    if (!match) {
        return null;
    }

    const parsed = Number.parseInt(match[0], 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function formatOddsLine(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}

function parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === ',' && !inQuotes) {
            cells.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    cells.push(current.trim());
    return cells;
}

function parseCsvToNormalizedObjects(csvContent: string): CsvParseResult {
    const lines = csvContent
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    if (!lines.length) {
        return { objects: [], errors: ['CSV content is empty.'] };
    }

    const headerCells = parseCsvLine(lines[0]);
    const headerMap = new Map<string, number>();
    headerCells.forEach((header, idx) => {
        headerMap.set(header.trim().toLowerCase(), idx);
    });

    const contestTitleIdx = headerMap.get('propfuturename');
    const contestantNameIdx = headerMap.get('contestantname');
    const contestantFirstLineIdx = headerMap.get('contestantfirstline');

    if (contestTitleIdx === undefined || contestantNameIdx === undefined || contestantFirstLineIdx === undefined) {
        return {
            objects: [],
            errors: ['CSV headers must include PropFutureName, ContestantName, and ContestantFirstLine.'],
        };
    }

    const groupedByTitle = new Map<string, NormalizedParticipant[]>();
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
        const rowNumber = i + 1;
        const cells = parseCsvLine(lines[i]);

        const contestTitle = (cells[contestTitleIdx] || '').trim();
        const contestantName = (cells[contestantNameIdx] || '').trim();
        const contestantFirstLine = (cells[contestantFirstLineIdx] || '').trim();

        if (!contestTitle || !contestantName || !contestantFirstLine) {
            errors.push(`CSV row ${rowNumber} is missing required values.`);
            continue;
        }

        if (!groupedByTitle.has(contestTitle)) {
            groupedByTitle.set(contestTitle, []);
        }

        groupedByTitle.get(contestTitle)!.push({
            name: normalizeContestantDisplayName(contestantName),
            odds: contestantFirstLine,
        });
    }

    const objects: NormalizedOddsItem[] = Array.from(groupedByTitle.entries()).map(([title, participants]) => ({
        website: 'csv',
        title,
        participants,
        sourceUrl: 'csv-upload',
    }));

    return { objects, errors };
}

function buildAggregatedSummaryObjects(
    normalizedData: NormalizedOddsItem[],
    order: string,
): AggregatedSummaryObject[] {
    const groupedByContestant = new Map<string, { displayName: string; oddsList: number[] }>();

    const nonEmptyTitles = normalizedData
        .map((entry) => entry.title)
        .filter((title): title is string => typeof title === 'string' && title.trim().length > 0);

    const uniqueTitles = Array.from(new Set(nonEmptyTitles));
    const aggregatedContestTitle = uniqueTitles.length === 1 ? uniqueTitles[0] : 'Aggregated Contest';

    for (const entry of normalizedData) {
        if (!Array.isArray(entry.participants)) {
            continue;
        }

        for (const participant of entry.participants) {
            if (!participant || typeof participant.name !== 'string' || typeof participant.odds !== 'string') {
                continue;
            }

            const comparisonKey = getContestantComparisonKey(participant.name);
            const displayName = normalizeContestantDisplayName(participant.name);
            const parsedOdds = parseOddsNumber(participant.odds);
            if (parsedOdds === null) {
                continue;
            }

            if (!groupedByContestant.has(comparisonKey)) {
                groupedByContestant.set(comparisonKey, {
                    displayName,
                    oddsList: [],
                });
            }

            const groupedContestant = groupedByContestant.get(comparisonKey)!;
            groupedContestant.displayName = groupedContestant.displayName || displayName;
            groupedContestant.oddsList.push(parsedOdds);
        }
    }

    const metricBuilders = {
        Highest: (oddsList: number[]) =>
            oddsList.slice(1).reduce((acc, current) => Number(scraperMiscFns.higherOdds(current, acc)), oddsList[0]),
        Lowest: (oddsList: number[]) =>
            oddsList.slice(1).reduce((acc, current) => Number(scraperMiscFns.lowerOdds(current, acc)), oddsList[0]),
        Average: (oddsList: number[]) => Number(scraperMiscFns.roundUp(scraperMiscFns.averageOdds(oddsList.length, oddsList))),
    };

    const summaryTitles: Array<'Highest' | 'Lowest' | 'Average'> = ['Highest', 'Lowest', 'Average'];

    return summaryTitles.map((summaryTitle) => {
        const contestants: AggregatedContestant[] = [];

        for (const groupedContestant of groupedByContestant.values()) {
            if (!groupedContestant.oddsList.length) {
                continue;
            }

            const metricOdds = metricBuilders[summaryTitle](groupedContestant.oddsList);
            const line = formatOddsLine(metricOdds);

            contestants.push({
                name: groupedContestant.displayName,
                odds: line,
                rotation: 0,
            });
        }

        if (order === 'alph') {
            scraperMiscFns.sortAlphObj(contestants);
        }

        const baseRotation = scraperMiscFns.generateRotationNumber();
        for (let i = 0; i < contestants.length; i++) {
            contestants[i].rotation = baseRotation + i;
        }

        return {
            website: 'aggregate',
            title: summaryTitle,
            contests: [{
                title: aggregatedContestTitle,
                contestants,
            }],
        };
    });
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<globalThis.Response> {
    const abortController = new AbortController();
    const timer = setTimeout(() => {
        abortController.abort();
    }, timeoutMs);

    try {
        return await fetch(url, {
            ...init,
            signal: abortController.signal,
        });
    } finally {
        clearTimeout(timer);
    }
}

export interface LocalScraperServerOptions {
    port?: number;
}

// Starts a small Express server inside the Electron main process.
// This exposes the same /scraper/scrape endpoint you have in your API,
// but bound to http://localhost:<port> on the end user's machine.
export function startLocalScraperServer(options: LocalScraperServerOptions = {}) {
    const port = options.port ?? 3675; // choose any free port you like

    const app = express();

    // Allow calls from your production frontend only
    app.use(cors({
        origin: ['https://www.toolsross.com', 'http://localhost:3000']
    }));

    app.use(express.json({ limit: '1mb' }));

    // Mirror your API route: POST /scraper/scrape
    app.post('/scraper/scrape', (req: Request, res: Response) => {
        // Delegate to your existing controller. It already does:
        //  - validation of url, maxOdds, order, oddsType
        //  - puppeteer navigation (runWithPage)
        //  - site detection (DraftKings / OddsChecker / default)
        //  - JSON response formatting
        void scrapeWebsite(req, res);
    });

    // New route: scrape one or many links and normalize response to
    // [{ website, title, participants, sourceUrl }].
    // Optional csvContent can be provided to append CSV-based contests
    // in the same shape before aggregate summaries are calculated.
    app.post('/scraper/scrape-links', async (req: Request, res: Response) => {
        const {
            links,
            maxOdds,
            order,
            oddsType,
            timeoutMs,
            retryCount,
            csvContent,
            options = {},
        } = (req.body || {}) as BulkScrapeRequestBody;

        const normalizedLinks = Array.isArray(links)
            ? links.filter((link): link is string => typeof link === 'string' && link.trim().length > 0)
            : typeof links === 'string' && links.trim().length > 0
                ? [links]
                : [];

        if (normalizedLinks.length === 0 && (!csvContent || !csvContent.trim())) {
            return res.status(400).json({
                error: 'Provide at least one link in "links" or provide non-empty "csvContent".',
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

        const effectiveTimeoutMs =
            typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
                ? clampNumber(timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
                : DEFAULT_TIMEOUT_MS;

        const effectiveRetryCount =
            typeof retryCount === 'number' && Number.isFinite(retryCount)
                ? clampNumber(Math.floor(retryCount), 0, MAX_RETRY_COUNT)
                : DEFAULT_RETRY_COUNT;

        const data: NormalizedOddsItem[] = [];
        const errors: Array<{ url: string; error: string }> = [];

        // Sequential processing is intentional to reduce anti-bot triggers
        // and avoid opening many browser sessions at the same time.
        for (const url of normalizedLinks) {
            const domain = getDomain(url);

            if (!domain) {
                errors.push({ url, error: 'Invalid URL.' });
                continue;
            }

            if (!SUPPORTED_WEBSITES.has(domain)) {
                errors.push({
                    url,
                    error: `Unsupported website: ${domain}. Add a site scraper first.`,
                });
                continue;
            }

            let wasSuccessful = false;
            let lastError = 'Unknown scrape error';

            for (let attempt = 0; attempt <= effectiveRetryCount; attempt++) {
                try {
                    const response = await fetchWithTimeout(
                        `http://127.0.0.1:${port}/scraper/scrape`,
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                url,
                                maxOdds,
                                order,
                                oddsType,
                                options,
                            }),
                        },
                        effectiveTimeoutMs,
                    );

                    const payload = await response.json().catch((): Record<string, unknown> => ({}));

                    if (!response.ok) {
                        const message = typeof payload.error === 'string' ? payload.error : `Scrape failed with status ${response.status}.`;
                        throw new Error(message);
                    }

                    const scrapedData = (payload as Record<string, unknown>).data;
                    data.push(...normalizeScrapedData(url, domain, scrapedData));
                    wasSuccessful = true;
                    break;
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : String(error);
                    lastError = message;

                    if (attempt < effectiveRetryCount) {
                        await wait(500 * (attempt + 1));
                    }
                }
            }

            if (!wasSuccessful) {
                errors.push({ url, error: lastError });
            }
        }

        if (typeof csvContent === 'string' && csvContent.trim().length > 0) {
            const csvParseResult = parseCsvToNormalizedObjects(csvContent);
            data.push(...csvParseResult.objects);

            for (const csvError of csvParseResult.errors) {
                errors.push({
                    url: 'csv-upload',
                    error: csvError,
                });
            }
        }

        const summaryObjects = buildAggregatedSummaryObjects(data, order);

        return res.json({
            data: [...data, ...summaryObjects],
            errors,
            timeoutMs: effectiveTimeoutMs,
            retryCount: effectiveRetryCount,
            supportedWebsites: Array.from(SUPPORTED_WEBSITES),
        });
    });

    const server = app.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(`Local scraper API listening on http://localhost:${port}/scraper/scrape and /scraper/scrape-links`);
    });

    // Return a small disposer so the caller (main.ts) can
    // cleanly stop the HTTP server on app quit.
    return () => {
        server.close(() => {
            // eslint-disable-next-line no-console
            console.log('Local scraper API server closed');
        });
    };
}
