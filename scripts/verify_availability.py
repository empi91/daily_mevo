#!/usr/bin/env python3
"""
Spot-check that Saturday availability numbers update after aggregation.

Usage:
  uv run python scripts/verify_availability.py snapshot   # take baseline now
  uv run python scripts/verify_availability.py compare    # compare after next aggregation
"""

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import asyncpg

BASELINE_FILE = Path(__file__).parent / "availability_baseline.json"
LOCAL_TZ = ZoneInfo("Europe/Warsaw")
SATURDAY = 5  # ISODOW-1: 0=Mon … 5=Sat … 6=Sun


def _load_db_url() -> str:
    env_file = Path(__file__).parent.parent / ".env"
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line.startswith("MEVO_DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("MEVO_DATABASE_URL not found in .env")


async def cmd_snapshot(pool: asyncpg.Pool) -> None:
    now_warsaw = datetime.now(LOCAL_TZ)
    current_time = now_warsaw.time().replace(tzinfo=None)

    rows = await pool.fetch(
        """
        SELECT station_id,
               time_slot::text          AS time_slot,
               avg_bikes,
               avg_ebikes,
               sample_count,
               updated_at::text         AS updated_at
        FROM   station_availability
        WHERE  day_of_week = $1
          AND  time_slot >= $2
          AND  time_slot <= '20:00:00'::time
        ORDER  BY RANDOM()
        LIMIT  50
        """,
        SATURDAY,
        current_time,
    )

    if not rows:
        print(
            "No Saturday rows found between now and 20:00. "
            "Either no Saturday data exists yet, or the window is too narrow."
        )
        sys.exit(1)

    wm = await pool.fetchrow(
        "SELECT last_processed_id, updated_at FROM agg_watermark WHERE id = 1"
    )

    baseline = {
        "captured_at_utc": datetime.now(timezone.utc).isoformat(),
        "captured_at_warsaw": now_warsaw.isoformat(),
        "time_window": f"{current_time.strftime('%H:%M:%S')} – 20:00 (Warsaw, Saturday slots)",
        "agg_watermark_id": wm["last_processed_id"] if wm else None,
        "agg_last_ran_at": str(wm["updated_at"]) if wm else None,
        "rows": [dict(r) for r in rows],
    }

    BASELINE_FILE.write_text(json.dumps(baseline, indent=2, default=str))

    print(f"Baseline saved → {BASELINE_FILE}")
    print(
        f"Rows captured : {len(rows)} (Saturday slots {current_time.strftime('%H:%M')} – 20:00 Warsaw)"
    )
    print()
    if wm:
        print(f"Last aggregation ran at : {wm['updated_at']}")
        print(f"Agg watermark ID        : {wm['last_processed_id']}")
    print()
    print("Aggregation runs every HOUR on the server.")
    print("Wait until after the next hourly cycle completes, then run:")
    print()
    print("  uv run python scripts/verify_availability.py compare")


async def cmd_compare(pool: asyncpg.Pool) -> None:
    if not BASELINE_FILE.exists():
        print(f"No baseline at {BASELINE_FILE}. Run `snapshot` first.")
        sys.exit(1)

    baseline = json.loads(BASELINE_FILE.read_text())
    before_map: dict[tuple[str, str], dict] = {
        (r["station_id"], r["time_slot"]): r for r in baseline["rows"]
    }

    station_ids = list({r["station_id"] for r in baseline["rows"]})
    time_slots = list({r["time_slot"] for r in baseline["rows"]})

    current_rows = await pool.fetch(
        """
        SELECT station_id,
               time_slot::text  AS time_slot,
               avg_bikes,
               avg_ebikes,
               sample_count,
               updated_at::text AS updated_at
        FROM   station_availability
        WHERE  day_of_week = $1
          AND  station_id  = ANY($2::text[])
          AND  time_slot::text = ANY($3::text[])
        """,
        SATURDAY,
        station_ids,
        time_slots,
    )
    after_map: dict[tuple[str, str], dict] = {
        (r["station_id"], r["time_slot"]): r for r in current_rows
    }

    wm = await pool.fetchrow(
        "SELECT last_processed_id, updated_at FROM agg_watermark WHERE id = 1"
    )

    print(f"Baseline taken : {baseline['captured_at_warsaw']}")
    print(f"Now            : {datetime.now(LOCAL_TZ).isoformat()}")
    if wm:
        print(
            f"Last agg ran   : {wm['updated_at']}  (watermark ID: {wm['last_processed_id']})"
        )
        if baseline.get("agg_watermark_id") == wm["last_processed_id"]:
            print()
            print(
                "WARNING: agg watermark ID hasn't changed — aggregation may not have run yet."
            )
    print()

    col = "{:<36} {:<8} {:>14} {:>14} {:>10} {:>10}"
    print(
        col.format(
            "station_id",
            "slot",
            "avg_bikes_before",
            "avg_bikes_after",
            "samples_Δ",
            "updated?",
        )
    )
    print("-" * 98)

    changed = unchanged = missing = 0

    for key in sorted(before_map):
        station_id, time_slot = key
        before = before_map[key]
        after = after_map.get(key)

        if after is None:
            missing += 1
            print(
                col.format(
                    station_id,
                    time_slot,
                    f"{before['avg_bikes']:.2f}",
                    "(gone)",
                    0,
                    "MISSING",
                )
            )
            continue

        delta = after["sample_count"] - before["sample_count"]
        updated = after["updated_at"] != before["updated_at"]

        if delta > 0 or updated:
            changed += 1
        else:
            unchanged += 1

        print(
            col.format(
                station_id,
                time_slot,
                f"{before['avg_bikes']:.2f}",
                f"{after['avg_bikes']:.2f}",
                f"{delta:+d}",
                "YES" if updated else "---",
            )
        )

    print()
    print(
        f"Changed: {changed}  |  Unchanged: {unchanged}  |  Missing: {missing}  |  Total: {len(before_map)}"
    )

    if unchanged == len(before_map):
        print(
            "\nNOTHING updated — aggregation likely hasn't run yet since the baseline was taken."
        )
    elif changed == len(before_map):
        print("\nAll rows updated. Aggregation is working correctly.")
    else:
        print(f"\nPartial update ({changed}/{len(before_map)}).")
        print(
            "Rows that didn't change had no new Saturday snapshots in those specific slots."
        )


async def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in ("snapshot", "compare"):
        print(__doc__)
        sys.exit(1)

    db_url = _load_db_url().replace("postgresql+asyncpg://", "postgresql://")
    pool = await asyncpg.create_pool(
        db_url, min_size=1, max_size=2, statement_cache_size=0
    )
    try:
        if sys.argv[1] == "snapshot":
            await cmd_snapshot(pool)
        else:
            await cmd_compare(pool)
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
