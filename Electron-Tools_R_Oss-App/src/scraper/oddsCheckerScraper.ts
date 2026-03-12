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

            let rowLength = currentOddsInRow.length;
            let higherOddsTemp = 0;
            let lowerOddsTemp = 9999999;
            let averageoddsTemp;

            if (oddsType === 'highest') {
                for (const oddsElement of currentOddsInRow) {
                    const oddsText = await oddsElement.evaluate((el: any) => el.innerText);
                    const currentOdds = oddsText !== undefined ? scraperMiscFns.cutToOddsLimit(oddsText, maxOdds) : ' ';

                    if (oddsText !== '') {
                        higherOddsTemp = scraperMiscFns.higherOdds(currentOdds, higherOddsTemp);
                    }
                }
                contestant.odds = higherOddsTemp;
            } else if (oddsType === 'lowest') {
                for (const oddsElement of currentOddsInRow) {
                    const oddsText = await oddsElement.evaluate((el: any) => el.innerText);
                    const currentOdds = oddsText !== undefined ? scraperMiscFns.cutToOddsLimit(oddsText, maxOdds) : ' ';

                    if (oddsText !== '') {
                        lowerOddsTemp = scraperMiscFns.lowerOdds(currentOdds, lowerOddsTemp);
                    }
                }
                contestant.Odds = lowerOddsTemp;
            } else if (oddsType === 'average') {
                const oddsInTheRow: any[] = [];
                for (const oddsElement of currentOddsInRow) {
                    const oddsText = await oddsElement.evaluate((el: any) => el.innerText);
                    const currentOdds = oddsText !== undefined ? scraperMiscFns.cutToOddsLimit(oddsText, maxOdds) : ' ';

                    if (currentOdds === '') {
                        rowLength = rowLength - 1;
                    } else {
                        oddsInTheRow.push(currentOdds);
                    }
                }

                averageoddsTemp = scraperMiscFns.averageOdds(rowLength, oddsInTheRow);
                const averageoddsTempRounded = scraperMiscFns.roundUp(averageoddsTemp);

                contestant.Odds = averageoddsTempRounded;
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
