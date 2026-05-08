import { ODDSCHECKER } from './constants';
import * as scraperMiscFns from './scraperMiscFunctions';

// OddsChecker scraper object
// Copied and adapted from Api_Tools_R_Oss/models/scrapers/oddsCheckerScraper.js

export const oddsCheckerScraper = {
    oddsTable: async (page: any, { url, maxOdds, order, oddsType }: any) => {
        await page.evaluate(() => {
            (document.body as HTMLElement).style.transform = 'scale(0.1)';
            (document.body as HTMLElement).style.transformOrigin = 'top left';
        });

        const compareAllOddsButton = await page.$(ODDSCHECKER.SELECTORS.COMPARE_ALL_BUTTON);
        console.log('Found "Compare All Odds" button:', !!compareAllOddsButton);

        let contestantsList: any[] = [];
        const scrapedContestObj: any = {
            title: '',
            subtitle: '',
            contestants: [],
        };

        const title = await page.$eval(ODDSCHECKER.SELECTORS.H1, (el: any) => el.innerText);
        scrapedContestObj.title = title;

        const subtitle = await page.$eval(ODDSCHECKER.SELECTORS.H2, (el: any) => el.innerText);
        scrapedContestObj.subtitle = subtitle;

        if (compareAllOddsButton) {
            await compareAllOddsButton.click();
            console.log('Clicked "Compare All Odds" button.');
        }

        let allContestants: any[] = [];
        let allRows: any[] = [];

        try {
            allContestants = await page.$$(ODDSCHECKER.SELECTORS.NAMES_CLASS);
        } catch (err: any) {
            console.warn(`Could not find elements with selector "${ODDSCHECKER.SELECTORS.NAMES_CLASS}":`, err.message);
        }

        try {
            allRows = await page.$$(ODDSCHECKER.SELECTORS.ROWS_CLASS);
        } catch (err: any) {
            console.warn(`Could not find elements with selector "${ODDSCHECKER.SELECTORS.ROWS_CLASS}":`, err.message);
        }

        if (allContestants.length === 0 || allRows.length === 0) {
            console.warn('No contestants or rows found. Check your selectors in constants.ts');
            return { site: 'oddschecker', type: 'oddsTable', contests: [scrapedContestObj], warning: 'No contestants or rows found' };
        }

        for (let index = 0; index < allContestants.length; index++) {
            const contestant: any = {};
            contestant.name = await allContestants[index].evaluate((el: any) => el.innerText);
            const currentRow = allRows[index];
            let currentOddsInRow = await currentRow.$$(ODDSCHECKER.SELECTORS.ODDS_CLASS);

            let higherOddsTemp: number | null = null;
            let lowerOddsTemp: number | null = null;
            let averageOddsTemp;

            if (oddsType === 'highest') {
                for (const oddsElement of currentOddsInRow) {
                    const oddsText = await oddsElement.evaluate((el: any) => el.innerText);
                    const trimmedOddsText = typeof oddsText === 'string' ? oddsText.trim() : '';
                    if (trimmedOddsText === '') {
                        continue;
                    }

                    const currentOdds = scraperMiscFns.cutToOddsLimit(trimmedOddsText, maxOdds);
                    const parsedCurrentOdds = parseInt(String(currentOdds), 10);
                    if (Number.isNaN(parsedCurrentOdds)) {
                        continue;
                    }

                    if (higherOddsTemp === null) {
                        higherOddsTemp = parsedCurrentOdds;
                    } else {
                        higherOddsTemp = scraperMiscFns.higherOdds(parsedCurrentOdds, higherOddsTemp);
                    }
                }
                contestant.odds = higherOddsTemp ?? 0;
            } else if (oddsType === 'lowest') {
                for (const oddsElement of currentOddsInRow) {
                    const oddsText = await oddsElement.evaluate((el: any) => el.innerText);
                    const trimmedOddsText = typeof oddsText === 'string' ? oddsText.trim() : '';
                    if (trimmedOddsText === '') {
                        continue;
                    }

                    const currentOdds = scraperMiscFns.cutToOddsLimit(trimmedOddsText, maxOdds);
                    const parsedCurrentOdds = parseInt(String(currentOdds), 10);
                    if (Number.isNaN(parsedCurrentOdds)) {
                        continue;
                    }

                    if (lowerOddsTemp === null) {
                        lowerOddsTemp = parsedCurrentOdds;
                    } else {
                        lowerOddsTemp = scraperMiscFns.lowerOdds(parsedCurrentOdds, lowerOddsTemp);
                    }
                }
                contestant.odds = lowerOddsTemp ?? 0;
            } else if (oddsType === 'average') {
                const oddsInTheRow: any[] = [];
                for (const oddsElement of currentOddsInRow) {
                    const oddsText = await oddsElement.evaluate((el: any) => el.innerText);
                    const trimmedOddsText = typeof oddsText === 'string' ? oddsText.trim() : '';
                    if (trimmedOddsText === '') {
                        continue;
                    }

                    const currentOdds = scraperMiscFns.cutToOddsLimit(trimmedOddsText, maxOdds);
                    const parsedCurrentOdds = parseInt(String(currentOdds), 10);
                    if (!Number.isNaN(parsedCurrentOdds)) {
                        oddsInTheRow.push(parsedCurrentOdds);
                    }
                }

                const rowLength = oddsInTheRow.length;
                averageOddsTemp = scraperMiscFns.averageOdds(rowLength, oddsInTheRow);
                const averageOddsTempRounded = scraperMiscFns.roundUp(averageOddsTemp);

                contestant.odds = averageOddsTempRounded;
            }
            contestantsList.push(contestant);
        }

        if (order === 'alph') {
            contestantsList = scraperMiscFns.sortAlphObj(contestantsList);
        }

        const baseRotation = scraperMiscFns.generateRotationNumber();
        for (let i = 0; i < contestantsList.length; i++) {
            contestantsList[i].rotation = baseRotation + i;
        }

        scrapedContestObj.contestants = contestantsList;

        const finalContestsList: any[] = [];
        finalContestsList.push(scrapedContestObj);

        return { site: 'oddschecker', type: 'oddsTable', contests: finalContestsList };
    },
};
