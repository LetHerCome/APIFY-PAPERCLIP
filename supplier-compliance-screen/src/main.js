import { Actor } from 'apify';
import { buildFdaSearchUrl, calculateRisk, matchesEpaFacility, normalizeInput, reportActorFailure } from './helpers.js';

const FDA_TYPES = ['food', 'drug', 'device'];
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
        const url = buildFdaSearchUrl(category, company, lookbackYears, maxMatches);
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
    return matches.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, maxMatches);
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
        return (result.Facilities || []).filter((facility) => matchesEpaFacility(company, facility.FacName)).slice(0, 10).map((facility) => ({
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
    const { companies, companyStates, sources, lookbackYears, maxMatches } = normalizeInput(await Actor.getInput() || {});

    for (const [index, company] of companies.entries()) {
        const errors = [];
        const companyState = companyStates[index];
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
    await Actor.exit();
} catch (error) {
    await reportActorFailure(Actor, error);
}
