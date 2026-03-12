// Helper functions for odds normalization and contest list manipulation.
// Copied from Api_Tools_R_Oss/models/scrapers/scraperMiscFunctions.js.

export const compareMaxOdds = (userGivenMaxOdds: string | number) => {
    let pUserMaxOdds: string | number;
    if (userGivenMaxOdds === '') {
        pUserMaxOdds = '20000';
    } else {
        pUserMaxOdds = userGivenMaxOdds;
    }

    return pUserMaxOdds;
};

export const compareRotations = (userGivenRotation: string | number) => {
    let pUserRotation: number;

    if (userGivenRotation === '') {
        pUserRotation = Math.floor(Math.random() * (999999 - 11111 + 1)) + 11111;
    } else {
        pUserRotation = parseInt(String(userGivenRotation), 10);
    }
    return pUserRotation;
};

export const removeSign = (odds: string) => {
    const oddsNumber = odds.replace('+', '');
    return oddsNumber;
};

export const cutOdds = (parsedOdds: number, userGivenMaxOdds: number) => {
    let cutOddsValue: number;
    if (parsedOdds > userGivenMaxOdds) {
        cutOddsValue = userGivenMaxOdds;
    } else {
        cutOddsValue = parsedOdds;
    }
    return cutOddsValue;
};

export const cutToOddsLimit = (odds: string, userGivenMaxOdds: number) => {
    let oddsNumber: string;
    let parsedOdds: number | string;
    if (odds.includes('+')) {
        oddsNumber = removeSign(odds);
        parsedOdds = cutOdds(parseInt(oddsNumber, 10), parseInt(String(userGivenMaxOdds), 10));
    } else {
        parsedOdds = odds;
    }

    return parsedOdds;
};

export const sortAlphObj = (pContestantsList: any[]) => {
    if (!pContestantsList || pContestantsList.length === 0) {
        console.warn('sortAlphObj received invalid list:', pContestantsList);
        return pContestantsList;
    }

    pContestantsList.sort((a, b) => {
        const aName = a.name || a.Name;
        const bName = b.name || b.Name;

        if (!aName || !bName) {
            console.warn('sortAlphObj: contestant missing name property', { a, b });
            return 0;
        }

        return String(aName).localeCompare(String(bName));
    });

    return pContestantsList;
};

export const averageOdds = (thisRowLength: number, thisCurrentOdds: (string | number)[]) => {
    if (!thisCurrentOdds || thisCurrentOdds.length === 0 || thisRowLength === 0) {
        console.warn('averageOdds received invalid data:', { thisRowLength, oddsCount: thisCurrentOdds?.length });
        return 0;
    }

    let addUp = 0;
    thisCurrentOdds.forEach((odds) => {
        const parsed = parseInt(String(odds), 10);
        addUp += parsed;
    });

    return addUp / thisRowLength;
};

export const higherOdds = (thiscurrentOdds: any, higherOddsTemp: any) => {
    if ((String(thiscurrentOdds)[0] !== '-' && thiscurrentOdds > higherOddsTemp) || (String(thiscurrentOdds)[0] === '-' && thiscurrentOdds < higherOddsTemp)) {
        return thiscurrentOdds;
    } else {
        return higherOddsTemp;
    }
};

export const lowerOdds = (thiscurrentOdds: any, higherOddsTemp: any) => {
    const parsedCurrent = parseInt(String(thiscurrentOdds), 10);
    if ((String(parsedCurrent)[0] !== '-' && parsedCurrent < higherOddsTemp) || (String(parsedCurrent)[0] === '-' && parsedCurrent > higherOddsTemp)) {
        return parsedCurrent;
    } else {
        return higherOddsTemp;
    }
};

export const roundUp = (number: any) => {
    if (number === undefined || number === null || Number.isNaN(Number(number))) {
        console.warn('roundUp received invalid number:', number);
        return 0;
    }
    const parsedNumber = parseInt(String(number), 10);
    return Math.ceil(parsedNumber / 10) * 10;
};

export const generateRotationNumber = () => {
    return Math.floor(Math.random() * (999999 - 100000 + 1)) + 100000;
};
