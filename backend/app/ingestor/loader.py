import asyncio
from collections.abc import Callable
from datetime import datetime

from sqlalchemy.dialects.postgresql import insert

from app.database import AsyncSessionLocal
from app.models import Event, IntervalEvent, LapEvent, PositionEvent, QualifyingPhase, SessionResult
from app.ingestor.openf1 import (
    fetch_drivers, fetch_location,
    fetch_position, fetch_intervals, fetch_laps, fetch_stints, fetch_race_control, fetch_session_result,
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
    semaphore = asyncio.Semaphore(2)

    async def load_driver_laps(driver: dict) -> int:
        if is_cancelled and is_cancelled():
            return 0
        async with semaphore:
            dn = driver["driver_number"]
            acronym = num_to_acronym.get(dn, str(dn))
            try:
                laps = await fetch_laps(session_key, dn)
                stints = await fetch_stints(session_key, dn)
            except Exception as e:
                print(f"  {acronym}: skipping laps/stints — {e}")
                return 0
            if not laps:
                return 0

            # Build lap_number → (compound, tyre_age_at_start) from stints.
            # A stint covers [lap_start, lap_end] inclusive.
            stint_map: dict[int, tuple[str | None, int]] = {}
            for s in stints:
                compound = s.get("compound")
                age = s.get("tyre_age_at_start") or 0
                lap_s = s.get("lap_start") or 0
                lap_e = s.get("lap_end") or lap_s
                for ln in range(lap_s, lap_e + 1):
                    stint_map[ln] = (compound, age)

            lap_rows = []
            for lap in laps:
                raw_ts = lap.get("date_start")
                if not raw_ts or lap.get("lap_number") is None:
                    continue
                ts = datetime.fromisoformat(raw_ts.replace("Z", "+00:00")).timestamp()
                ln = lap["lap_number"]
                compound, tyre_age = stint_map.get(ln, (None, 0))
                lap_rows.append({
                    "race_id": race_id,
                    "driver_id": acronym,
                    "lap_number": ln,
                    "timestamp": ts,
                    "lap_duration": lap.get("lap_duration"),
                    "compound": compound,
                    "tyre_age_at_start": tyre_age,
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

    # ── Qualifying phase boundaries (race_control, qualifying sessions only) ─
    phase_count = 0
    if not (is_cancelled and is_cancelled()):
        try:
            rc_events = await fetch_race_control(session_key)
            phases: dict[int, dict] = {}
            for ev in rc_events:
                qp = ev.get("qualifying_phase")
                if not qp or ev.get("category") != "SessionStatus":
                    continue
                ts = datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).timestamp()
                msg = ev.get("message", "")
                phases.setdefault(qp, {})
                if "STARTED" in msg:
                    phases[qp]["start"] = ts
                elif "FINISHED" in msg:
                    phases[qp]["end"] = ts
            phase_rows = [
                {"race_id": race_id, "phase": num, "start_ts": b["start"], "end_ts": b.get("end")}
                for num, b in phases.items() if "start" in b
            ]
            if phase_rows:
                async with AsyncSessionLocal() as session:
                    for row in phase_rows:
                        await session.execute(
                            insert(QualifyingPhase).values(row).on_conflict_do_nothing()
                        )
                    await session.commit()
            phase_count = len(phase_rows)
            print(f"  Qualifying phases: stored {phase_count} boundaries")
        except Exception as e:
            print(f"  Race control not available for session {session_key}: {e}")

    # ── Session results (DNF / DNS / DSQ) ────────────────────────────────
    result_count = 0
    if not (is_cancelled and is_cancelled()):
        try:
            raw_results = await fetch_session_result(session_key)
            result_rows = []
            for r in raw_results:
                acronym = num_to_acronym.get(r.get("driver_number"))
                if not acronym:
                    continue
                result_rows.append({
                    "race_id": race_id,
                    "driver_id": acronym,
                    "dnf": bool(r.get("dnf")),
                    "dns": bool(r.get("dns")),
                    "dsq": bool(r.get("dsq")),
                    "number_of_laps": r.get("number_of_laps"),
                })
            if result_rows:
                async with AsyncSessionLocal() as session:
                    for row in result_rows:
                        await session.execute(insert(SessionResult).values(row).on_conflict_do_nothing())
                    await session.commit()
            result_count = len(result_rows)
            print(f"  Session results: stored {result_count} entries")
        except Exception as e:
            print(f"  Session results not available for session {session_key}: {e}")

    return {"positions": pos_count, "intervals": int_count, "laps": lap_count, "phases": phase_count, "results": result_count}
