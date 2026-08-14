"""
Pulls daily price/yield data for More Investment House (מור בית השקעות)
mutual funds from bizportal.co.il's public data feed.

Earlier attempts, in order:
  1. TASE Data Hub official API -- correct data, but a paid subscription
     (~$250/month), not worth it for personal tracking.
  2. FINQ's public API (api.finqai.co.il) -- free, no key, but the data
     returned was ~7.5 months stale (every record dated Dec 2025) when
     checked on 2026-08-14.
  3. This one: bizportal.co.il's mutual-funds page loads its entire table
     from a single static JSON file, client-side. Confirmed on 2026-08-14
     via the file's Last-Modified header (same-day) and by cross-checking
     several fund rows against the rendered HTML table -- this is the feed
     bizportal's own live site runs on, not a stale demo endpoint. 102
     More Investment fund entries.

Field mapping below (a-i) was verified by matching JSON values against the
rendered HTML table for the same fund IDs. Columns beyond 'i' exist in the
feed (j, k, l, n, o, p, q, r, s) but their meaning wasn't confidently
verified against the UI, so they're intentionally not surfaced here.
"""
from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

FEED_URL = "https://www.bizportal.co.il/json/mutualfunds/92769366-2684-49c7-b0bc-a0f760099aac.json"
MORE_FUND_MANAGER = "מור"
USER_AGENT = "Mozilla/5.0 (investment-dashboard scraper; contact: naftali.dratman@gmail.com)"


@dataclass
class FundObservation:
    fund_id: str
    fund_name: str
    nav_date: str  # ISO date, from the feed's Last-Modified header
    redemption_price: float | None
    purchase_price: float | None
    daily_change_pct: float | None
    monthly_change_pct: float | None
    yearly_change_pct: float | None
    assets: float | None
    fetched_at: str


def fetch_more_funds() -> list[FundObservation]:
    req = urllib.request.Request(FEED_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        last_modified = resp.headers.get("Last-Modified")
        records = json.load(resp)

    nav_date = (
        parsedate_to_datetime(last_modified).date().isoformat()
        if last_modified
        else datetime.now(timezone.utc).date().isoformat()
    )
    fetched_at = datetime.now(timezone.utc).isoformat()

    observations: list[FundObservation] = []
    for r in records:
        if r.get("c") != MORE_FUND_MANAGER:
            continue
        observations.append(
            FundObservation(
                fund_id=str(r["a"]),
                fund_name=r["b"].strip(),
                nav_date=nav_date,
                redemption_price=r.get("d"),
                purchase_price=r.get("e"),
                daily_change_pct=r.get("f"),
                monthly_change_pct=r.get("g"),
                yearly_change_pct=r.get("h"),
                assets=r.get("i"),
                fetched_at=fetched_at,
            )
        )
    return observations


if __name__ == "__main__":
    obs = fetch_more_funds()
    print(f"Fetched {len(obs)} More Investment fund observations, as of {obs[0].nav_date if obs else '?'}.")
    print(json.dumps([obs[0].__dict__], ensure_ascii=False, indent=2))
