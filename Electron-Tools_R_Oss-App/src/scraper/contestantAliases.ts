import aliasData from './contestantAliases.json';

interface ContestantAliasEntry {
    match: string;
    canonicalName: string;
}

const NAME_ALIAS_RULES: ContestantAliasEntry[] = aliasData as ContestantAliasEntry[];

const NAME_ALIAS_MAP = new Map<string, string>(
    NAME_ALIAS_RULES.map((rule) => [normalizeNameForMatching(rule.match), rule.canonicalName]),
);

function normalizeNameForMatching(name: string): string {
    return String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[\u2019']/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function getContestantComparisonKey(name: string): string {
    const compact = normalizeNameForMatching(name);

    if (!compact) {
        return 'unknown participant';
    }

    const canonicalName = NAME_ALIAS_MAP.get(compact);
    if (canonicalName) {
        return canonicalName.toLowerCase();
    }

    return compact;
}

export function normalizeContestantDisplayName(name: string): string {
    const compact = normalizeNameForMatching(name);

    if (!compact) {
        return 'Unknown participant';
    }

    const canonicalName = NAME_ALIAS_MAP.get(compact);
    if (canonicalName) {
        return canonicalName;
    }

    return String(name || '').trim() || 'Unknown participant';
}
