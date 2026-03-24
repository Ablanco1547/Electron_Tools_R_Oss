// BetOnline scraper and detection logic
// Patterned after the DraftKings scraper, but focused on
// capturing all "get-contests-by-contest-type2" network
// responses. Each such response corresponds to one contest
// visible on the BetOnline site at that moment.

import * as scraperMiscFns from './scraperMiscFunctions';

// Context may include:
// { url, maxOdds, order, oddsType, betOnlineNetworkData, options }
export async function detectBetOnlineType(page: any, context: any = {}) {
    const { betOnlineNetworkData } = context || {};

    if (Array.isArray(betOnlineNetworkData?.contestResponses) && betOnlineNetworkData.contestResponses.length > 0) {
        // When we have captured one or more contests API calls,
        // route to the dedicated contestsApi handler.
        return 'contestsApi';
    }

    // Fallback type when no contests API calls were detected.
    return 'lobby';
}

function buildContestFromBetOnlineJson(json: any, { maxOdds, order }: any = {}) {
    if (!json || typeof json !== 'object') {
        console.warn('BetOnline: invalid contests JSON object');
        return null;
    }

    const contestOfferings = json.ContestOfferings;
    if (!contestOfferings || typeof contestOfferings !== 'object') {
        console.warn('BetOnline: missing ContestOfferings root');
        return null;
    }

    const dateGroups = Array.isArray(contestOfferings.DateGroup) ? contestOfferings.DateGroup : [];
    const firstDateGroup = dateGroups[0];
    const descriptionGroups =
        firstDateGroup && Array.isArray(firstDateGroup.DescriptionGroup) ? firstDateGroup.DescriptionGroup : [];
    const firstDescriptionGroup = descriptionGroups[0];
    const timeGroups =
        firstDescriptionGroup && Array.isArray(firstDescriptionGroup.TimeGroup) ? firstDescriptionGroup.TimeGroup : [];
    const firstTimeGroup = timeGroups[0];

    const contestExtended = firstTimeGroup?.ContestExtended;
    if (!contestExtended || typeof contestExtended !== 'object') {
        console.warn('BetOnline: missing ContestExtended in JSON');
        return null;
    }

    const groupLines = Array.isArray(contestExtended.ContestGroupLine)
        ? contestExtended.ContestGroupLine
        : contestExtended.ContestGroupLine
            ? [contestExtended.ContestGroupLine]
            : [];

    if (!groupLines.length) {
        console.warn('BetOnline: no ContestGroupLine entries found');
        return null;
    }

    const title =
        firstDescriptionGroup?.Description ||
        contestOfferings.ContestType2 ||
        contestOfferings.ContestType ||
        'Unknown contest';

    const subtitle =
        firstDateGroup?.Comment ||
        contestOfferings.ContestType3 ||
        contestOfferings.ContestType2 ||
        contestOfferings.ContestType ||
        '';

    const contestants: any[] = [];

    for (const groupLine of groupLines) {
        const rawContestants = Array.isArray(groupLine.Contestants) ? groupLine.Contestants : [];

        for (const c of rawContestants) {
            const name = c?.Name || c?.name || 'Unknown contestant';

            const moneyLine = c?.Line?.MoneyLine?.Line;
            if (moneyLine === undefined || moneyLine === null) {
                continue;
            }

            let american: any = moneyLine;

            if (typeof maxOdds === 'number') {
                const prefixed = Number(american) > 0 ? `+${american}` : String(american);
                american = scraperMiscFns.cutToOddsLimit(String(prefixed), maxOdds);
            }

            contestants.push({
                name,
                odds: String(american),
            });
        }
    }

    if (!contestants.length) {
        console.warn('BetOnline: no valid contestants extracted from JSON');
        return null;
    }

    if (order === 'alph') {
        scraperMiscFns.sortAlphObj(contestants);
    }

    const baseRotation = scraperMiscFns.generateRotationNumber();
    for (let i = 0; i < contestants.length; i++) {
        contestants[i].rotation = baseRotation + i;
    }

    return {
        title,
        subtitle,
        contestants,
    };
}

export const betOnlineScraper = {
    // Simple lobby handler – mostly for diagnostics and as a fallback
    // when we did not capture any contests API traffic.
    lobby: async (page: any, { url, betOnlineNetworkData }: any) => {
        let title: string | null = null;

        try {
            title = await page.title();
        } catch {
            title = null;
        }

        const totalContestResponses = Array.isArray(betOnlineNetworkData?.contestResponses)
            ? betOnlineNetworkData.contestResponses.length
            : 0;

        return {
            site: 'betonline',
            type: 'lobby',
            url,
            title,
            totalContestResponses,
        };
    },

    // Handler for the captured "get-contests-by-contest-type2" API
    // responses. This transforms each response JSON into the
    // standardized contests structure:
    //   { title, subtitle, contestants[{ name, odds, rotation }] }
    contestsApi: async (page: any, { url, maxOdds, order, betOnlineNetworkData }: any) => {
        const contestResponses = Array.isArray(betOnlineNetworkData?.contestResponses)
            ? betOnlineNetworkData.contestResponses
            : [];

        const contests: any[] = [];

        for (const entry of contestResponses) {
            const json = entry?.json;
            const built = buildContestFromBetOnlineJson(json, { maxOdds, order });
            if (built) {
                contests.push(built);
            }
        }

        return {
            site: 'betonline',
            type: 'contestsApi',
            sourceUrl: url,
            contestsCount: contests.length,
            contests,
        };
    },
};
