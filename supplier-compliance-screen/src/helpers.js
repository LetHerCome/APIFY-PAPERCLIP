export function cleanCompany(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function escapeOpenFda(value) {
    return value.replace(/[\\"()]/g, (character) => `\\${character}`);
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
