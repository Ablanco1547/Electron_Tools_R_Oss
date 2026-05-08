// bet487.org scraper scaffold.
// Replace the placeholder extraction logic with site-specific selectors/API interception.

export async function detectBet487Type(page: any) {
    const hasOddsTable = await page.$('.odds-table, .market-table, .event-row');
    if (hasOddsTable) {
        return 'oddsTable';
    }

    return 'lobby';
}

export const bet487Scraper = {
    lobby: async (page: any, { url }: { url: string }) => {
        let title = '';

        try {
            title = await page.title();
        } catch {
            title = '';
        }

        return {
            site: 'bet487',
            type: 'lobby',
            sourceUrl: url,
            contests: [
                {
                    title: title || 'Bet487 Lobby',
                    subtitle: 'Placeholder',
                    contestants: [],
                },
            ],
        };
    },

    oddsTable: async (page: any, { url }: { url: string }) => {
        // Intentionally minimal scaffold: this shape is already compatible
        // with localScraperServer normalizeScrapedData.
        const heading = await page
            .$eval('h1', (el: any) => (el as HTMLElement).innerText)
            .catch(() => 'Bet487 Event');

        return {
            site: 'bet487',
            type: 'oddsTable',
            sourceUrl: url,
            contests: [
                {
                    title: heading,
                    subtitle: 'Implement selectors/network parsing',
                    contestants: [],
                },
            ],
        };
    },
};
