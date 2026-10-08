# Supplier Compliance Screen

Apify Actor MVP that checks up to three US company names against public **openFDA enforcement** and **EPA ECHO facility** records. It emits one dataset row per company and links each match to the official source.

This is an approximate name search for research support. A match does not establish wrongdoing; verify every record with the source agency before acting.

## Input

```json
{
  "companies": ["Tyson Foods", "Blue Bell Creameries", "Johnson & Johnson"],
  "companyStates": ["AR", "TX", "NJ"],
  "sources": ["fda", "epa"],
  "lookbackYears": 5,
  "maxMatchesPerCompany": 10
}
```

- `companies`: 1–3 non-empty company names; one output row per unique name.
- `state`: optional two-letter state abbreviation for EPA ECHO.
- `companyStates`: optional state list aligned by index with `companies`, overriding the global `state`.
- `sources`: `fda`, `epa`, or both. Defaults to both.
- `lookbackYears`: FDA date window, from 1 to 10 years. EPA returns its agency summary window.
- `maxMatchesPerCompany`: FDA result cap across food, drug, and device endpoints, from 1 to 10. EPA facility rows are capped at 10.

## Output

Each dataset item includes `company`, `query`, `fda.recalls`, `epa.facilities`, `riskScore` (0–100), `riskBasis`, `sourcesChecked`, `fetchedAt`, `errors`, and a disclaimer. A score is a transparent count-based signal, not a legal or compliance conclusion. FDA returns enforcement records; EPA fields are ECHO facility indicators.

## Sources and operating behavior

- FDA: `https://api.fda.gov/{food,drug,device}/enforcement.json` (official, keyless API; terms: <https://open.fda.gov/terms/>).
- EPA: <https://echodata.epa.gov/echo/echo_rest_services.get_facilities> (official ECHO search service).
- The Actor makes sequential requests, waits between source calls and companies, retries throttling/server errors with backoff, uses no proxy, and limits each run to three companies.
- EPA name search uses ECHO's `p_fn` facility-name parameter, state filter, and a small response set. The API's returned facility rows may not correspond to the corporate parent.

## Run locally

Requires Node.js 20+ and the Apify CLI.

```sh
npm install
apify run
```

`INPUT.json` contains a small three-company sample for local verification. The Actor uses public endpoints only and does not evade CAPTCHA, WAF, or access controls.

## Test input

The three sample names from the candidate brief are Tyson Foods (AR), Blue Bell Creameries (TX), and Johnson & Johnson (NJ); `companyStates` applies their individual state filters by list order in the bundled input.

## Scope

This MVP is for evaluation on the Apify free plan. It is not published in the Apify Store and contains no monetization configuration.
