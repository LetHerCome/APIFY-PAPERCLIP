import { Actor } from 'apify';
import { calculateRisk, cleanCompany, escapeOpenFda } from './helpers.js';

const FDA_TYPES = ['food', 'drug', 'device'];
const FDA_BASE = 'https://api.fda.gov';
const EPA_URL = 'https://echodata.epa.gov/echo/echo_rest_services.get_facilities';
const USER_AGENT = 'SupplierComplianceScreen/0.1 (Apify public-data research actor)';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, { attempts = 3, timeoutMs = 20_000 } = {}) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            const response = await fetch(url, {
                headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (response.status === 404) return { noResults: true };
            if (response.status === 429 || response.status >= 500) {
                const error = new Error(`HTTP ${response.status}`);
                error.retryAfter = response.headers.get('retry-after');
                throw error;
            }
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            lastError = error;
            if (attempt + 1 < attempts) {
                const retryAfter = Number(error.retryAfter);
                await sleep(Number.isFinite(retryAfter) && retryAfter > 0
                    ? Math.min(retryAfter * 1000, 10_000)
                    : 1000 * (attempt + 1));
            }
        }
    }
    throw lastError;
}

function fdaDate(record) {
    const raw = record.report_date || record.recall_initiation_date || '';
    if (!/^\d{8}$/.test(raw)) return null;
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function recentEnough(record, cutoff) {
    const date = fdaDate(record);
    return !date || new Date(`${date}T00:00:00Z`) >= cutoff;
}

async function getFdaRecords(company, lookbackYears, maxMatches, errors) {
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - lookbackYears);
    const matches = [];
    for (const category of FDA_TYPES) {
        const url = new URL(`${FDA_BASE}/${category}/enforcement.json`);
        url.searchParams.set('search', `recalling_firm:"${escapeOpenFda(company)}"`);
        url.searchParams.set('limit', String(Math.min(maxMatches, 10)));
        try {
            const result = await fetchJson(url);
            if (result.noResults) continue;
            for (const item of result.results || []) {
                if (!recentEnough(item, cutoff)) continue;
                matches.push({
                    recall_number: item.recall_number || null,
                    classification: item.classification || null,
                    reason: item.reason_for_recall || null,
                    date: fdaDate(item),
                    product: item.product_description || null,
                    recalling_firm: item.recalling_firm || null,
                    url: `https://api.fda.gov/${category}/enforcement.json?search=recall_number:${encodeURIComponent(item.recall_number || '')}`,
                    category,
                });
            }
        } catch (error) {
            errors.push({ source: `fda-${category}`, message: error.message });
        }
        await sleep(350);
    }
    return matches.slice(0, maxMatches);
}

async function getEpaFacilities(company, state, errors) {
    const url = new URL(EPA_URL);
    url.searchParams.set('output', 'JSON');
    url.searchParams.set('p_fn', company);
    if (state) url.searchParams.set('p_st', state.toUpperCase());
    url.searchParams.set('tablelist', 'Y');
    url.searchParams.set('responseset', '10');
    url.searchParams.set('queryset', '500');
    try {
        const data = await fetchJson(url);
        const result = data.Results || {};
        if (result.Error?.ErrorMessage) throw new Error(result.Error.ErrorMessage);
        if (result.Message !== 'Success') throw new Error(result.Message || 'EPA returned an unknown response');
        return (result.Facilities || []).slice(0, 10).map((facility) => ({
            registry_id: facility.RegistryID || null,
            name: facility.FacName || null,
            city: facility.FacCity || null,
            state: facility.FacState || null,
            quarters_in_noncompliance: facility.FacQtrsWithNC || null,
            formal_actions: facility.FacFormalActionCount || null,
            penalties: facility.FacTotalPenalties || null,
            compliance_status: facility.FacComplianceStatus || null,
            url: facility.RegistryID
                ? `https://echo.epa.gov/detailed-facility-report?fid=${encodeURIComponent(facility.RegistryID)}`
                : null,
        }));
    } catch (error) {
        errors.push({ source: 'epa-echo', message: error.message });
        return [];
    }
}

await Actor.init();
try {
    const input = await Actor.getInput() || {};
    const companies = [...new Set((input.companies || []).map(cleanCompany).filter(Boolean))];
    if (companies.length < 1 || companies.length > 3) throw new Error('Provide between 1 and 3 non-empty company names.');
    const sources = input.sources || ['fda', 'epa'];
    if (!Array.isArray(sources) || sources.some((source) => !['fda', 'epa'].includes(source))) {
        throw new Error('sources may contain only "fda" and "epa".');
    }
    const state = input.state ? String(input.state).trim().toUpperCase() : '';
    if (state && !/^[A-Z]{2}$/.test(state)) throw new Error('state must be a two-letter US state abbreviation.');
    const companyStates = input.companyStates || [];
    if (!Array.isArray(companyStates) || companyStates.length > companies.length) throw new Error('companyStates must be a state list aligned with companies.');
    const lookbackYears = Number(input.lookbackYears ?? 5);
    const maxMatches = Number(input.maxMatchesPerCompany ?? 10);
    if (!Number.isInteger(lookbackYears) || lookbackYears < 1 || lookbackYears > 10) throw new Error('lookbackYears must be an integer from 1 to 10.');
    if (!Number.isInteger(maxMatches) || maxMatches < 1 || maxMatches > 10) throw new Error('maxMatchesPerCompany must be an integer from 1 to 10.');

    for (const [index, company] of companies.entries()) {
        const errors = [];
        const companyState = String(companyStates[index] || state).trim().toUpperCase();
        if (companyState && !/^[A-Z]{2}$/.test(companyState)) throw new Error(`Invalid state for ${company}; use a two-letter abbreviation.`);
        const fda = sources.includes('fda') ? await getFdaRecords(company, lookbackYears, maxMatches, errors) : [];
        await sleep(750);
        const epa = sources.includes('epa') ? await getEpaFacilities(company, companyState, errors) : [];
        const risk = calculateRisk(fda, epa);
        const sourcesChecked = sources.map((source) => source === 'fda' ? 'openFDA enforcement API' : 'US EPA ECHO facility search');
        await Actor.pushData({
            company,
            query: { state: companyState || null, sources, lookbackYears, maxMatchesPerCompany: maxMatches },
            fda: { recalls: fda, count: fda.length },
            epa: { facilities: epa, count: epa.length },
            riskScore: risk.score,
            riskBasis: risk.basis,
            sourcesChecked,
            fetchedAt: new Date().toISOString(),
            errors,
            disclaimer: 'Name matching is approximate. Results link to public records and do not establish wrongdoing. Review each official record before making decisions.',
        });
        await sleep(1000);
    }
} finally {
    await Actor.exit();
}
