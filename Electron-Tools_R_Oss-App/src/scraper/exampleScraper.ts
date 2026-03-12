// Example site scraper object
// Copied from Api_Tools_R_Oss/models/scrapers/exampleScraper.js.

export const exampleSiteScraper = {
    listA: async (page: any, { url }: { url: string }) => {
        const items = await page.evaluate(() =>
            Array.from(document.querySelectorAll('.item-a')).map((el) => (el as HTMLElement).innerText),
        );
        return { site: 'example', type: 'listA', items };
    },
    listB: async (page: any, { url }: { url: string }) => {
        const items = await page.evaluate(() =>
            Array.from(document.querySelectorAll('.item-b')).map((el) => (el as HTMLElement).innerText),
        );
        return { site: 'example', type: 'listB', items };
    },
};
