import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { scrapeWebsite } from './scraper/scrapeController';

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
        origin: 'https://www.toolsross.com',
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

    const server = app.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(`Local scraper API listening on http://localhost:${port}/scraper/scrape`);
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
