// Scraper constants organized by site
// Copied from Api_Tools_R_Oss/models/scrapers/constants.js so the
// Electron app can run the same scraping logic locally.

// OddsChecker selectors and configs
export const ODDSCHECKER = {
    SELECTORS: {
        NAMES_CLASS: '.BetRowLeftBetName_b1n9ldp0',
        ODDS_CLASS: '.OddsCellDesktop_oqljncf',
        ROWS_CLASS: '.BetRow_blvcniz',
        COMPARE_ALL_BUTTON: 'button[aria-label="Compare All Odds"]',
        H1: 'h1',
        H2: 'h2',
    },
    TIMEOUTS: {
        AFTER_CLICK: 5000,
        PAGE_LOAD: 30000,
    },
    VIEWPORT: {
        WIDTH: 1920,
        HEIGHT: 6000,
    },
} as const;

// DraftKings selectors and configs
export const DRAFTKINGS = {
    SELECTORS: {
        PLAYER_PROP: '[data-test="player-prop"]',
        LOBBY_ITEM: '.lobby-item',
        CONTEST_DETAILS: '.contest-details',
        GOLF_PLAYER: '.golf-player',
        PLAYER_NAME: '.player-name',
        ODDS: '.odds',
    },
    TIMEOUTS: {
        PAGE_LOAD: 30000,
    },
} as const;

// Sports411 selectors and configs
export const SPORTS411 = {
    SELECTORS: {
        ODDS_TABLE: '.odds-table, .market-table, .event-row',
    },
} as const;

// Generic/shared constants
export const COMMON = {
    TIMEOUTS: {
        DEFAULT_WAIT: 3000,
        NETWORK_IDLE: 'networkidle2',
    },
} as const;
