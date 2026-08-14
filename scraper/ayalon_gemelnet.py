"""
Pulls Ayalon Bituach Menahelim (managers insurance) track data from the
Israeli Capital Market Authority's official open dataset on data.gov.il
("ביטוח-נט" / Insurance-Net), rather than scraping the gemelnet.cma.gov.il
UI directly (that site is a legacy ASP.NET WebForms app with no stable API).

Dataset: https://data.gov.il/dataset/insurance
Confirmed via direct query on 2026-08-14: 20 distinct Ayalon tracks, reported
monthly (REPORT_PERIOD as YYYYMM). This is the real cadence of the official
source -- there is no publicly available daily figure for these tracks.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from datetime import datetime, timezone

CKAN_BASE = "https://data.gov.il/api/3/action/datastore_search"

# "ביטוח-נט" resources by reporting year range. The current-year resource is
# the one that matters for ongoing tracking; the others are for backfill.
INSURANCE_NET_RESOURCES = {
    "1999-2022": "584e6b69-174f-46c9-b8db-03925b4c68c6",
    "2023": "672090ba-7893-4496-a07c-dc7e822cbf18",
    "2024-today": "c6c62cc7-fe02-4b18-8f3e-813abfbb4647",
}

AYALON_QUERY = "איילון"
USER_AGENT = "Mozilla/5.0 (investment-dashboard scraper; contact: naftali.dratman@gmail.com)"


@dataclass
class TrackObservation:
    fund_id: int
    fund_name: str
    fund_classification: str
    parent_company_name: str
    report_period: int  # YYYYMM
    total_assets: float | None
    avg_annual_management_fee: float | None
    monthly_yield: float | None
    year_to_date_yield: float | None
    yield_trailing_3_yrs: float | None
    yield_trailing_5_yrs: float | None
    standard_deviation: float | None
    fetched_at: str


def _fetch_resource(resource_id: str, query: str, limit: int = 10000) -> list[dict]:
    params = urllib.parse.urlencode({"resource_id": resource_id, "q": query, "limit": limit})
    url = f"{CKAN_BASE}?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.load(resp)
    if not payload.get("success"):
        raise RuntimeError(f"data.gov.il query failed for resource {resource_id}: {payload}")
    return payload["result"]["records"]


def fetch_ayalon_tracks(include_history: bool = False) -> list[TrackObservation]:
    """Fetch all Ayalon managers-insurance track observations.

    include_history=False (default): only the current-year resource, i.e.
    what you want for the daily/monthly job.
    include_history=True: also pulls the 2023 and 1999-2022 resources for a
    one-time backfill.
    """
    resource_keys = ["2024-today"]
    if include_history:
        resource_keys = ["1999-2022", "2023", "2024-today"]

    fetched_at = datetime.now(timezone.utc).isoformat()
    observations: list[TrackObservation] = []
    for key in resource_keys:
        records = _fetch_resource(INSURANCE_NET_RESOURCES[key], AYALON_QUERY)
        for r in records:
            observations.append(
                TrackObservation(
                    fund_id=r["FUND_ID"],
                    fund_name=r["FUND_NAME"].strip(),
                    fund_classification=(r.get("FUND_CLASSIFICATION") or "").strip(),
                    parent_company_name=(r.get("PARENT_COMPANY_NAME") or "").strip(),
                    report_period=r["REPORT_PERIOD"],
                    total_assets=r.get("TOTAL_ASSETS"),
                    avg_annual_management_fee=r.get("AVG_ANNUAL_MANAGEMENT_FEE"),
                    monthly_yield=r.get("MONTHLY_YIELD"),
                    year_to_date_yield=r.get("YEAR_TO_DATE_YIELD"),
                    yield_trailing_3_yrs=r.get("YIELD_TRAILING_3_YRS"),
                    yield_trailing_5_yrs=r.get("YIELD_TRAILING_5_YRS"),
                    standard_deviation=r.get("STANDARD_DEVIATION"),
                    fetched_at=fetched_at,
                )
            )
    return observations


if __name__ == "__main__":
    obs = fetch_ayalon_tracks()
    print(f"Fetched {len(obs)} observations across "
          f"{len({o.fund_id for o in obs})} Ayalon tracks.")
    print(json.dumps([asdict(o) for o in obs[:3]], ensure_ascii=False, indent=2))
