import * as scraperMiscFns from './scraperMiscFunctions';

function normalizeOdds(oddsValue: any): any {
    if (typeof oddsValue === 'string') {
        return oddsValue.replace(/[−–—]/g, '-');
    }

    return oddsValue;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
    if (Array.isArray(value)) {
        return value;
    }

    if (value === null || value === undefined) {
        return [];
    }

    return [value];
}

function buildContestsFromSchedule(scheduleJson: any, { maxOdds, order }: any = {}) {
    const leagues = asArray(scheduleJson?.Schedule?.Data?.Leagues?.League);

    if (!leagues.length) {
        console.warn('Sports411: no leagues found in GetSchedule JSON');
        return [];
    }

    const contests: any[] = [];
    const seenGameKeys = new Set<string>();

    for (const league of leagues) {
        const leagueDescription = league?.Description || 'Sports411';
        const dateGroups = asArray(league?.dateGroup);

        for (const dateGroup of dateGroups) {
            const dateDescription = dateGroup?.description || dateGroup?.date || '';
            const games = asArray(dateGroup?.game);

            for (const game of games) {
                const gameKey = String(
                    game?.uuid ||
                    game?.ParentUUID ||
                    game?.idgm ||
                    `${leagueDescription}-${dateDescription}-${game?.htm || 'unknown-game'}`,
                );

                if (seenGameKeys.has(gameKey)) {
                    continue;
                }

                seenGameKeys.add(gameKey);

                const title = game?.htm || dateDescription || leagueDescription || 'Unknown contest';
                const subtitle = dateDescription || leagueDescription || '';
                const lines = asArray(game?.Derivatives?.line);
                const contestants: any[] = [];

                for (const line of lines) {
                    const name = line?.tmname || 'Unknown contestant';
                    let american: any = line?.odds ?? line?.oddsh ?? null;

                    if (american === null || american === undefined) {
                        continue;
                    }

                    american = normalizeOdds(american);

                    if (typeof maxOdds === 'number') {
                        const prefixed = Number(american) > 0 ? `+${american}` : String(american);
                        american = scraperMiscFns.cutToOddsLimit(String(prefixed), maxOdds);
                    }

                    contestants.push({
                        name,
                        odds: String(american),
                    });
                }

                if (!contestants.length) {
                    continue;
                }

                if (order === 'alph') {
                    scraperMiscFns.sortAlphObj(contestants);
                }

                const baseRotation = scraperMiscFns.generateRotationNumber();
                for (let i = 0; i < contestants.length; i++) {
                    contestants[i].rotation = baseRotation + i;
                }

                contests.push({
                    title,
                    subtitle,
                    contestants,
                });
            }
        }
    }

    return contests;
}

export async function detectSports411Type(page: any, context: any = {}) {
    const { sports411NetworkData } = context || {};

    if (sports411NetworkData?.scheduleJson) {
        return 'getSchedule';
    }

    const hasOddsTable = await page.$('.odds-table, .market-table, .event-row');
    if (hasOddsTable) {
        return 'oddsTable';
    }

    return 'lobby';
}

export const sports411Scraper = {
    lobby: async (page: any, { url, sports411NetworkData }: any) => {
        let title = '';

        try {
            title = await page.title();
        } catch {
            title = '';
        }

        return {
            site: 'sports411',
            type: 'lobby',
            sourceUrl: url,
            scheduleUrl: sports411NetworkData?.scheduleUrl || null,
            scheduleJson: sports411NetworkData?.scheduleJson || null,
            contests: [
                {
                    title: title || 'Sports411 Lobby',
                    subtitle: 'Awaiting GetSchedule capture',
                    contestants: [],
                },
            ],
        };
    },

    getSchedule: async (page: any, { url, maxOdds, order, sports411NetworkData }: any) => {
        const scheduleJson = sports411NetworkData?.scheduleJson;
        const contests = buildContestsFromSchedule(scheduleJson, { maxOdds, order });

        return {
            site: 'sports411',
            type: 'getSchedule',
            sourceUrl: url,
            scheduleUrl: sports411NetworkData?.scheduleUrl || null,
            contests,
        };
    },

    oddsTable: async (page: any, { url }: { url: string }) => {
        const heading = await page
            .$eval('h1', (el: any) => (el as HTMLElement).innerText)
            .catch(() => 'Sports411 Event');

        return {
            site: 'sports411',
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
