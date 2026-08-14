"""SQLite storage for scraped track/fund observations, plus a JSON export
for the static dashboard to read (no server/DB needed to view it)."""
from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "investments.db"
EXPORT_PATH = DATA_DIR / "dashboard_export.json"

SCHEMA = """
CREATE TABLE IF NOT EXISTS ayalon_tracks (
    fund_id INTEGER NOT NULL,
    fund_name TEXT NOT NULL,
    fund_classification TEXT,
    parent_company_name TEXT,
    report_period INTEGER NOT NULL,
    total_assets REAL,
    avg_annual_management_fee REAL,
    monthly_yield REAL,
    year_to_date_yield REAL,
    yield_trailing_3_yrs REAL,
    yield_trailing_5_yrs REAL,
    standard_deviation REAL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (fund_id, report_period)
);

CREATE TABLE IF NOT EXISTS more_funds (
    fund_id TEXT NOT NULL,
    fund_name TEXT NOT NULL,
    nav_date TEXT NOT NULL,
    redemption_price REAL,
    purchase_price REAL,
    daily_change_pct REAL,
    monthly_change_pct REAL,
    yearly_change_pct REAL,
    assets REAL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (fund_id, nav_date)
);
"""


def get_connection() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    return conn


def upsert_ayalon_tracks(conn: sqlite3.Connection, observations) -> int:
    rows = [asdict(o) for o in observations]
    conn.executemany(
        """
        INSERT INTO ayalon_tracks (
            fund_id, fund_name, fund_classification, parent_company_name,
            report_period, total_assets, avg_annual_management_fee,
            monthly_yield, year_to_date_yield, yield_trailing_3_yrs,
            yield_trailing_5_yrs, standard_deviation, fetched_at
        ) VALUES (
            :fund_id, :fund_name, :fund_classification, :parent_company_name,
            :report_period, :total_assets, :avg_annual_management_fee,
            :monthly_yield, :year_to_date_yield, :yield_trailing_3_yrs,
            :yield_trailing_5_yrs, :standard_deviation, :fetched_at
        )
        ON CONFLICT(fund_id, report_period) DO UPDATE SET
            total_assets=excluded.total_assets,
            avg_annual_management_fee=excluded.avg_annual_management_fee,
            monthly_yield=excluded.monthly_yield,
            year_to_date_yield=excluded.year_to_date_yield,
            yield_trailing_3_yrs=excluded.yield_trailing_3_yrs,
            yield_trailing_5_yrs=excluded.yield_trailing_5_yrs,
            standard_deviation=excluded.standard_deviation,
            fetched_at=excluded.fetched_at
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def upsert_more_funds(conn: sqlite3.Connection, observations) -> int:
    rows = [asdict(o) for o in observations]
    conn.executemany(
        """
        INSERT INTO more_funds (
            fund_id, fund_name, nav_date, redemption_price, purchase_price,
            daily_change_pct, monthly_change_pct, yearly_change_pct, assets, fetched_at
        ) VALUES (
            :fund_id, :fund_name, :nav_date, :redemption_price, :purchase_price,
            :daily_change_pct, :monthly_change_pct, :yearly_change_pct, :assets, :fetched_at
        )
        ON CONFLICT(fund_id, nav_date) DO UPDATE SET
            redemption_price=excluded.redemption_price,
            purchase_price=excluded.purchase_price,
            daily_change_pct=excluded.daily_change_pct,
            monthly_change_pct=excluded.monthly_change_pct,
            yearly_change_pct=excluded.yearly_change_pct,
            assets=excluded.assets,
            fetched_at=excluded.fetched_at
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def export_dashboard_json(conn: sqlite3.Connection) -> None:
    conn.row_factory = sqlite3.Row
    ayalon = [dict(r) for r in conn.execute(
        "SELECT * FROM ayalon_tracks ORDER BY fund_name, report_period"
    )]
    more = [dict(r) for r in conn.execute(
        "SELECT * FROM more_funds ORDER BY fund_name, nav_date"
    )]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_PATH.write_text(
        json.dumps({"ayalon_tracks": ayalon, "more_funds": more}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
