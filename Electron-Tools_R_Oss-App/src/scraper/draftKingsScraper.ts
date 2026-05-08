// DraftKings scraper object with detection function
// Copied and adapted from Api_Tools_R_Oss/models/scrapers/draftKingsScraper.js

import * as scraperMiscFns from './scraperMiscFunctions';

// Normalize odds by replacing Unicode minus characters with regular hyphen-minus
function normalizeOdds(oddsValue: any): any {
    if (typeof oddsValue === 'string') {
        // Replace various Unicode minus/dash characters with regular hyphen-minus (-)
        return oddsValue.replace(/[−–—]/g, '-');
    }
    return oddsValue;
}

// Detection function for DraftKings
// context may include { url, maxOdds, order, oddsType, draftKingsNetworkData, options }
export async function detectDraftKingsType(page: any, context: any = {}) {
    const { draftKingsNetworkData } = context || {};

    if (draftKingsNetworkData?.marketsJson) {
        return 'directApiCallProps';
    }

    const hasPlayerProps = await page.$('[data-test="player-prop"]');
    if (hasPlayerProps) return 'playerProps';

    const hasGolfElements = await page.evaluate(() => {
        try {
            const text = (document.body?.innerText || '').toLowerCase();
            return text.includes('golf') || !!document.querySelector('.golf-tournament');
        } catch {
            return false;
        }
    });
    if (hasGolfElements) return 'golfList';

    const hasContestDetails = await page.$('.contest-details');
    if (hasContestDetails) return 'contestDetails';

    const hasLobby = await page.$$('.lobby-item');
    if (hasLobby.length > 0) return 'lobby';

    return 'lobby';
}

function buildDirectApiCallPropsFromMarkets(marketsJson: any, { maxOdds, order, oddsType }: any = {}) {
    if (!marketsJson || typeof marketsJson !== 'object') {
        console.warn('DraftKings markets JSON is not an object');
        return null;
    }

    const sports = Array.isArray(marketsJson.sports)
        ? marketsJson.sports
        : Array.isArray(marketsJson.Sports)
            ? marketsJson.Sports
            : [];

    const events = Array.isArray(marketsJson.events)
        ? marketsJson.events
        : Array.isArray(marketsJson.Events)
            ? marketsJson.Events
            : [];

    const markets = Array.isArray(marketsJson.markets)
        ? marketsJson.markets
        : Array.isArray(marketsJson.Markets)
            ? marketsJson.Markets
            : [];

    const selections = Array.isArray(marketsJson.selections)
        ? marketsJson.selections
        : Array.isArray(marketsJson.Selections)
            ? marketsJson.Selections
            : [];

    if (!events.length || !markets.length || !selections.length) {
        console.warn('DraftKings markets JSON missing events, markets, or selections array');
        return null;
    }

    const isFightProps = sports.some((s: any) => {
        const name = (s.name || '').toLowerCase();
        const seo = (s.seoIdentifier || '').toLowerCase();
        return name === 'mma' || seo === 'mma';

    });

    const selectionsByMarketId = new Map<string, any[]>();
    for (const sel of selections) {
        const mid = sel.marketId;
        if (!mid) continue;
        const key = String(mid);
        if (!selectionsByMarketId.has(key)) {
            selectionsByMarketId.set(key, []);
        }
        selectionsByMarketId.get(key)!.push(sel);
    }

    const baseRotation = scraperMiscFns.generateRotationNumber();
    let currentRotation = baseRotation;

    const contests: any[] = [];
    const sportName = sports[0]?.name || 'DraftKings';

    for (const event of events) {
        const eventId = event.id ?? event.eventId ?? event.EventId ?? null;
        const eventName = event.name ?? event.EventName ?? event.eventName ?? event.description ?? 'Unknown event';

        const eventMarkets = markets.filter((m: any) => {
            const mEventId = m.eventId ?? m.EventId ?? m.event?.id ?? null;
            return eventId !== null && mEventId === eventId;
        });

        if (!eventMarkets.length) {
            continue;
        }

        if (isFightProps) {
            const hasRoundBetting = eventMarkets.some((m: any) => {
                const name = (m.name ?? m.MarketName ?? m.marketName ?? '').toLowerCase();
                return name === 'round betting';
            });

            if (hasRoundBetting) {
                // Round Betting: separate contest per market with market name in title
                for (const market of eventMarkets) {
                    const marketName = market.name ?? market.MarketName ?? market.marketName ?? '';
                    const marketId = market.id ?? market.marketId ?? market.MarketId ?? null;

                    const marketSelections = (marketId !== null && selectionsByMarketId.get(String(marketId))) || [];

                    const contestants: any[] = [];

                    for (const sel of marketSelections) {
                        const baseName = sel.label ?? sel.name ?? sel.outcomeName ?? sel.description ?? 'Unknown selection';
                        const name = marketName ? `${baseName} ${marketName}` : baseName;

                        let american: any =
                            sel.displayOdds?.american ??
                            sel.displayOdds?.American ??
                            sel.oddsAmerican ??
                            sel.americanOdds ??
                            sel.price?.american ??
                            sel.price?.American ??
                            null;

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

                    if (contestants.length > 0) {
                        if (order === 'alph') {
                            scraperMiscFns.sortAlphObj(contestants);
                        }

                        for (const c of contestants) {
                            c.rotation = currentRotation++;
                        }
                        contests.push({
                            title: marketName ? `${eventName} - ${marketName}` : eventName,
                            subtitle: sportName,
                            contestants,
                        });
                    }
                }
            } else {
                // Non-Round Betting: combine all markets into one contest
                const contestants: any[] = [];

                for (const market of eventMarkets) {
                    const marketName = market.name ?? market.MarketName ?? market.marketName ?? '';
                    const marketId = market.id ?? market.marketId ?? market.MarketId ?? null;

                    const marketSelections = (marketId !== null && selectionsByMarketId.get(String(marketId))) || [];

                    for (const sel of marketSelections) {
                        const baseName = sel.label ?? sel.name ?? sel.outcomeName ?? sel.description ?? 'Unknown selection';
                        const name = marketName ? `${baseName} ${marketName}` : baseName;

                        let american: any =
                            sel.displayOdds?.american ??
                            sel.displayOdds?.American ??
                            sel.oddsAmerican ??
                            sel.americanOdds ??
                            sel.price?.american ??
                            sel.price?.American ??
                            null;

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
                }

                if (contestants.length > 0) {
                    if (order === 'alph') {
                        scraperMiscFns.sortAlphObj(contestants);
                    }

                    for (const c of contestants) {
                        c.rotation = currentRotation++;
                    }
                    contests.push({
                        title: eventName,
                        subtitle: sportName,
                        contestants,
                    });
                }
            }
        } else {
            for (const market of eventMarkets) {
                const marketName = market.name ?? market.MarketName ?? market.marketName ?? 'Unknown market';
                const marketId = market.id ?? market.marketId ?? market.MarketId ?? null;

                const marketSelections = (marketId !== null && selectionsByMarketId.get(String(marketId))) || [];

                const contestants: any[] = [];

                for (const sel of marketSelections) {
                    const name = sel.label ?? sel.name ?? sel.outcomeName ?? sel.description ?? 'Unknown selection';

                    let american: any =
                        sel.displayOdds?.american ??
                        sel.displayOdds?.American ??
                        sel.oddsAmerican ??
                        sel.americanOdds ??
                        sel.price?.american ??
                        sel.price?.American ??
                        null;

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

                if (contestants.length > 0) {
                    if (order === 'alph') {
                        scraperMiscFns.sortAlphObj(contestants);
                    }

                    for (const c of contestants) {
                        c.rotation = currentRotation++;
                    }
                    contests.push({
                        title: eventName,
                        subtitle: marketName,
                        contestants,
                    });
                }
            }
        }
    }

    // Explicitly type contests to avoid implicit any[] complaints
    return { site: 'draftkings', type: 'directApiCallProps', contests: contests as any[] };
}

export const draftKingsScraper = {
    lobby: async (page: any, { url, draftKingsNetworkData }: any) => {
        const title = await page.title();

        if (title && String(title).toLowerCase().includes('access denied')) {
            try {
                const currentUrl = page.url();
                const html = await page.content();
                const snippet = html ? String(html).slice(0, 1000) : '';
                console.warn('DraftKings lobby: Access Denied page detected', {
                    url: currentUrl,
                    title,
                    htmlSnippet: snippet,
                });
            } catch (e: any) {
                console.warn('DraftKings lobby: error while logging Access Denied diagnostics', e?.message || e);
            }
        }

        return {
            site: 'draftkings',
            type: 'lobby',
            title,
            marketsUrl: draftKingsNetworkData?.marketsUrl || null,
            marketsJson: draftKingsNetworkData?.marketsJson || null,
        };
    },

    directApiCallProps: async (page: any, { url, maxOdds, order, oddsType, draftKingsNetworkData }: any) => {
        const marketsJson = draftKingsNetworkData?.marketsJson;

        const transformed = buildDirectApiCallPropsFromMarkets(marketsJson, { maxOdds, order, oddsType });
        if (transformed) {
            return transformed;
        }

        return {
            site: 'draftkings',
            type: 'directApiCallProps',
            contests: [] as any[],
            warning: 'DraftKings directApiCallProps: could not transform markets JSON',
            marketsUrl: draftKingsNetworkData?.marketsUrl || null,
        };
    },

    contestDetails: async (page: any, { url, contestId, draftKingsNetworkData }: any) => {
        return {
            site: 'draftkings',
            type: 'contestDetails',
            contestId: contestId ?? null,
            marketsUrl: draftKingsNetworkData?.marketsUrl || null,
            marketsJson: draftKingsNetworkData?.marketsJson || null,
        };
    },
};
