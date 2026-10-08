export function cleanCompany(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

const EPA_NAME_IGNORED_TOKENS = new Set([
    'a', 'an', 'and', 'co', 'company', 'corp', 'corporation', 'group', 'inc',
    'incorporated', 'limited', 'llc', 'lp', 'ltd', 'the',
]);

function nameTokens(value) {
    return cleanCompany(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .match(/[a-z0-9]+/g)?.filter((token) => token.length > 1 && !EPA_NAME_IGNORED_TOKENS.has(token)) || [];
}

export function matchesEpaFacility(company, facilityName) {
    const companyTokens = [...new Set(nameTokens(company))];
    const facilityTokens = new Set(nameTokens(facilityName));
    return companyTokens.length > 0 && companyTokens.every((token) => facilityTokens.has(token));
}

export function uniqueCompanies(values) {
    const seen = new Set();
    return values.map(cleanCompany).filter((company) => {
        const key = company.toLocaleLowerCase('en-US');
        if (!company || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function escapeOpenFda(value) {
    return value.replace(/[\\"()]/g, (character) => `\\${character}`);
}

export function buildFdaSearchUrl(category, company, lookbackYears, maxMatches, now = new Date()) {
    const from = new Date(now);
    from.setUTCFullYear(from.getUTCFullYear() - lookbackYears);
    const dateRange = [from, now]
        .map((date) => date.toISOString().slice(0, 10).replaceAll('-', ''))
        .join(' TO ');
    const url = new URL(`https://api.fda.gov/${category}/enforcement.json`);
    url.searchParams.set('search', `recalling_firm:"${escapeOpenFda(company)}" AND report_date:[${dateRange}]`);
    url.searchParams.set('limit', String(Math.min(maxMatches, 10)));
    url.searchParams.set('sort', 'report_date:desc');
    return url;
}

export function calculateRisk(fda, epa) {
    let score = 0;
    const basis = [];
    if (fda.length) {
        score += Math.min(60, 20 + (fda.length - 1) * 5);
        basis.push(`${fda.length} matching recent FDA enforcement record(s)`);
    }
    const noncompliance = epa.filter((facility) => Number.parseInt(facility.quarters_in_noncompliance, 10) > 0);
    const formalActions = epa.filter((facility) => Number.parseInt(facility.formal_actions, 10) > 0);
    if (noncompliance.length) {
        score += Math.min(25, 10 + (noncompliance.length - 1) * 3);
        basis.push(`${noncompliance.length} EPA facility record(s) report quarters in non-compliance`);
    }
    if (formalActions.length) {
        score += Math.min(15, 8 + (formalActions.length - 1) * 2);
        basis.push(`${formalActions.length} EPA facility record(s) report formal actions`);
    }
    if (basis.length === 0) basis.push('No matching FDA records or EPA non-compliance/formal-action indicators in returned records');
    return { score: Math.min(100, score), basis };
}
