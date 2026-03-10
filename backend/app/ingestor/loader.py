import asyncio
from collections.abc import Callable
from datetime import datetime

from sqlalchemy.dialects.postgresql import insert

from app.database import AsyncSessionLocal
from app.models import Event, IntervalEvent, LapEvent, PositionEvent
from app.ingestor.openf1 import (
    fetch_drivers, fetch_location,
    fetch_position, fetch_intervals, fetch_laps,
)


async def load_race(
    race_id: str,
    session_key: int,
    on_driver_done: Callable[[int, int], None] | None = None,
    is_cancelled: Callable[[], bool] | None = None,
) -> int:
    drivers = await fetch_drivers(session_key)
    total = len(drivers)
    print(f"Found {total} drivers for session {session_key}")

    if on_driver_done:
        on_driver_done(0, total)

    async def load_driver(driver: dict) -> int:
        driver_number = driver["driver_number"]
        acronym = driver.get("name_acronym", str(driver_number))
        records = await fetch_location(session_key, driver_number)
        if not records:
            return 0

        rows = [
            {
                "race_id": race_id,
                "driver_id": acronym,
                "timestamp": datetime.fromisoformat(rec["date"].replace("Z", "+00:00")).timestamp(),
                "x": rec["x"],
                "y": rec["y"],
                "speed": rec["speed"],
                "raw_payload": rec["_raw"],
            }
            for rec in records
        ]

        chunk_size = 500
        async with AsyncSessionLocal() as session:
            for i in range(0, len(rows), chunk_size):
                stmt = (
                    insert(Event)
                    .values(rows[i : i + chunk_size])
                    .on_conflict_do_nothing()
                )
                await session.execute(stmt)
            await session.commit()

        print(f"  {acronym}: inserted up to {len(rows)} events")
        return len(rows)

    semaphore = asyncio.Semaphore(2)
    done_count = 0

    async def load_driver_limited(driver: dict) -> int:
        nonlocal done_count
        if is_cancelled and is_cancelled():
            return 0
        async with semaphore:
            if is_cancelled and is_cancelled():
                return 0
            result = await load_driver(driver)
            done_count += 1
            if on_driver_done:
                on_driver_done(done_count, total)
            return result

    tasks = [load_driver_limited(d) for d in drivers]
    results = await asyncio.gather(*tasks)
    events_total = sum(results)
    print(f"Done. Total events inserted: {events_total}")
    return events_total


def _parse_gap(raw) -> float | None:
    """Convert OpenF1 gap/interval field to float.
    Floats pass through; 'LAP N' strings become 1000.0 + N (sentinel for lapped cars)."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    if isinstance(raw, str):
        s = raw.strip().upper()
        if s.startswith("LAP"):
            try:
                return 1000.0 + int(s.split()[-1])
            except ValueError:
                return 9999.0
    return None


async def load_timing(
    race_id: str,
    session_key: int,
    is_cancelled: Callable[[], bool] | None = None,
) -> dict[str, int]:
    """Fetch and store position, interval, and lap data for a session."""
    drivers = await fetch_drivers(session_key)
    num_to_acronym: dict[int, str] = {
        d["driver_number"]: d.get("name_acronym", str(d["driver_number"]))
        for d in drivers
    }
    chunk_size = 500

    # ── Position events (whole-session, one call) ─────────────────────────
    pos_count = 0
    if not (is_cancelled and is_cancelled()):
        try:
            raw_positions = await fetch_position(session_key)
        except Exception as e:
            print(f"  Position data not available for session {session_key}: {e}")
            raw_positions = []
        pos_rows = []
        for rec in raw_positions:
            acronym = num_to_acronym.get(rec.get("driver_number"))
            if not acronym or rec.get("position") is None:
                continue
            ts = datetime.fromisoformat(rec["date"].replace("Z", "+00:00")).timestamp()
            pos_rows.append({"race_id": race_id, "driver_id": acronym, "timestamp": ts, "position": rec["position"]})
        if pos_rows:
            async with AsyncSessionLocal() as session:
                for i in range(0, len(pos_rows), chunk_size):
                    await session.execute(insert(PositionEvent).values(pos_rows[i:i + chunk_size]).on_conflict_do_nothing())
                await session.commit()
        pos_count = len(pos_rows)
        print(f"  Positions: inserted up to {pos_count} rows")

    # ── Interval events (whole-session, one call) ─────────────────────────
    int_count = 0
    if not (is_cancelled and is_cancelled()):
        try:
            raw_intervals = await fetch_intervals(session_key)
        except Exception as e:
            print(f"  Interval data not available for session {session_key}: {e}")
            raw_intervals = []
        int_rows = []
        for rec in raw_intervals:
            acronym = num_to_acronym.get(rec.get("driver_number"))
            if not acronym:
                continue
            ts = datetime.fromisoformat(rec["date"].replace("Z", "+00:00")).timestamp()
            int_rows.append({
                "race_id": race_id, "driver_id": acronym, "timestamp": ts,
                "gap_to_leader": _parse_gap(rec.get("gap_to_leader")),
                "interval": _parse_gap(rec.get("interval")),
            })
        if int_rows:
            async with AsyncSessionLocal() as session:
                for i in range(0, len(int_rows), chunk_size):
                    await session.execute(insert(IntervalEvent).values(int_rows[i:i + chunk_size]).on_conflict_do_nothing())
                await session.commit()
        int_count = len(int_rows)
        print(f"  Intervals: inserted up to {int_count} rows")

    # ── Lap events (per-driver, semaphore 3) ──────────────────────────────
    lap_count = 0
    semaphore = asyncio.Semaphore(3)

    async def load_driver_laps(driver: dict) -> int:
        if is_cancelled and is_cancelled():
            return 0
        async with semaphore:
            dn = driver["driver_number"]
            acronym = num_to_acronym.get(dn, str(dn))
            laps = await fetch_laps(session_key, dn)
            if not laps:
                return 0
            lap_rows = []
            for lap in laps:
                raw_ts = lap.get("date_start")
                if not raw_ts or lap.get("lap_number") is None:
                    continue
                ts = datetime.fromisoformat(raw_ts.replace("Z", "+00:00")).timestamp()
                lap_rows.append({
                    "race_id": race_id,
                    "driver_id": acronym,
                    "lap_number": lap["lap_number"],
                    "timestamp": ts,
                    "lap_duration": lap.get("lap_duration"),
                    "compound": lap.get("compound"),
                    "tyre_age_at_start": lap.get("tyre_age_at_start"),
                })
            if lap_rows:
                async with AsyncSessionLocal() as session:
                    for i in range(0, len(lap_rows), chunk_size):
                        await session.execute(insert(LapEvent).values(lap_rows[i:i + chunk_size]).on_conflict_do_nothing())
                    await session.commit()
            return len(lap_rows)

    lap_results = await asyncio.gather(*[load_driver_laps(d) for d in drivers])
    lap_count = sum(lap_results)
    print(f"  Laps: inserted up to {lap_count} rows")

    return {"positions": pos_count, "intervals": int_count, "laps": lap_count}
