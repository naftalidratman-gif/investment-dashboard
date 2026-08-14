# Investment Dashboard

Tracks two things:

1. **Ayalon Bituach Menahelim** (איילון ביטוח מנהלים) — all 20 investment tracks.
2. **More Investment House** (מור בית השקעות) — all mutual fund offerings (102 funds).

## Data sources

| Source | Covers | Cadence | Status |
|---|---|---|---|
| [data.gov.il "ביטוח-נט"](https://data.gov.il/dataset/insurance) — the Israel Capital Market Authority's official open dataset | Ayalon's 20 managers-insurance tracks | Monthly (this is the real cadence of the official source — there's no public daily figure for these) | **Live** |
| bizportal.co.il's public mutual-fund data feed | More Investment's 102 funds | Daily (mutual funds are legally required to report daily NAV; confirmed same-day via the feed's `Last-Modified` header) | **Live** |

**How we got here on the More Investment side**, since it took a few tries:
1. TASE's official Data Hub API has exactly this data, but it's a paid
   subscription (~$250/month) — not worth it for personal tracking.
2. FINQ's public API (`api.finqai.co.il`) is free and keyless, but the data
   it returned was ~7.5 months stale (every record dated Dec 2025) when
   checked on 2026-08-14.
3. **bizportal.co.il** renders its own mutual-funds page from a single static
   JSON file the browser fetches directly
   (`bizportal.co.il/json/mutualfunds/<id>.json`) — free, keyless, and
   verified live (same-day `Last-Modified`, and spot-checked against the
   rendered table). This is what `scraper/more_investment.py` uses.

We also evaluated `funder.co.il`, Ayalon's own site, and More's own site as
sources — all three actively block automated requests (HTTP 403, confirmed
against both a plain HTTP client and a real headless Chromium browser).

## Project layout

```
scraper/
  ayalon_gemelnet.py   # pulls Ayalon tracks from data.gov.il (monthly)
  more_investment.py   # pulls More's funds from bizportal.co.il (daily)
  store.py             # SQLite schema + JSON export for the dashboard
  run_daily.py         # entry point: fetch -> store -> export
data/
  investments.db       # SQLite database (committed so it's browsable)
  dashboard_export.json
dashboard/
  index.html, app.js   # static dashboard, no build step
```

## Running it locally

```bash
cd scraper
python3 run_daily.py          # fetches both sources, writes ../data/dashboard_export.json

cd ..
python3 -m http.server 8000   # serve the repo root so dashboard/ can fetch ../data/...
# open http://localhost:8000/dashboard/index.html
```

## A note on the two cadences

The dashboard's daily GitHub Action runs every day regardless, but the two
halves genuinely update at different rates because that's how the underlying
sources report:

- **More Investment**: real day-over-day movement, since mutual funds report
  NAV every trading day.
- **Ayalon**: the numbers only change roughly once a month, since that's the
  actual reporting cadence of the official regulator dataset. The daily run
  will just re-fetch the same figures until the next month's report lands —
  that's expected, not a bug.

The dashboard subtitle and each section's "as of" label make this explicit
rather than implying everything is equally fresh.

## Daily automation

`.github/workflows/daily-update.yml` runs `run_daily.py` every day at 04:00
UTC, commits the refreshed data, and redeploys the dashboard to GitHub
Pages. `.github/workflows/deploy-pages.yml` separately redeploys immediately
on any push to `main` (e.g. dashboard UI changes), independent of the daily
schedule.

## Where AI fits in (phase 3)

Once real daily/monthly history has accumulated, the natural next layer is
an LLM-driven summary pass over `dashboard_export.json`: flag tracks/funds
that deviated from their peer group, summarize day/month-over-month changes
in plain language, and surface trend commentary. That's intentionally not
built yet — it needs real history to be useful, and it should be framed as
informational analysis, not financial advice.
