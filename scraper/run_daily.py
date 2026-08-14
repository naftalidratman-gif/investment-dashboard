"""Daily entry point: fetch everything, store it, export for the dashboard.
Meant to be run by the GitHub Actions workflow, or manually.
"""
from __future__ import annotations

import sys

from ayalon_gemelnet import fetch_ayalon_tracks
from more_investment import fetch_more_funds
from store import get_connection, upsert_ayalon_tracks, upsert_more_funds, export_dashboard_json


def main() -> int:
    conn = get_connection()

    ayalon_obs = fetch_ayalon_tracks()
    n = upsert_ayalon_tracks(conn, ayalon_obs)
    print(f"[ayalon] upserted {n} observations across "
          f"{len({o.fund_id for o in ayalon_obs})} tracks")

    more_obs = fetch_more_funds()
    n = upsert_more_funds(conn, more_obs)
    print(f"[more] upserted {n} observations across "
          f"{len({o.fund_id for o in more_obs})} funds, as of "
          f"{more_obs[0].nav_date if more_obs else '?'}")

    export_dashboard_json(conn)
    print("[export] wrote data/dashboard_export.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
