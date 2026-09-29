from datetime import datetime
import re
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Event, IntervalEvent, LapEvent, PositionEvent,
    QualifyingPhase, RaceSession, SessionResult,
)
from app.ingestor.openf1 import BASE_URL, _get, fetch_race_control


def _parse_deleted_time_and_driver(msg: str) -> tuple[str, float] | None:
    """Parse driver acronym and lap time from a race control deletion message.
    Format: 'CAR 18 (STR) TIME 1:29.965 DELETED - TRACK LIMITS AT TURN ...'
    Returns (acronym, seconds) or None."""
    m = re.search(r'\(([A-Z]{2,3})\).*TIME\s+(\d+):(\d+\.\d+)', msg)
    if m:
        return m.group(1), int(m.group(2)) * 60 + float(m.group(3))
    m = re.search(r'\(([A-Z]{2,3})\).*TIME\s+(\d+\.\d+)', msg)
    if m:
        return m.group(1), float(m.group(2))
    return None


async def _first_motion_ts(race_id: str, db: AsyncSession) -> float | None:
    """Return the first timestamp where any driver's x/y changes by > 5 units."""
    result = await db.execute(
        text("""
            WITH prev AS (
                SELECT timestamp,
                       x - LAG(x) OVER (PARTITION BY driver_id ORDER BY timestamp) AS dx,
                       y - LAG(y) OVER (PARTITION BY driver_id ORDER BY timestamp) AS dy
                FROM events
                WHERE race_id = :race_id
            )
            SELECT MIN(timestamp) FROM prev
            WHERE (ABS(dx) > 5 OR ABS(dy) > 5)
              AND dx IS NOT NULL AND dy IS NOT NULL
        """),
        {"race_id": race_id},
    )
    return result.scalar()


async def _race_start_ts(race_id: str, db: AsyncSession) -> float | None:
    """Timestamp the first driver actually completes lap 1.

    Single source of truth for "when did the race actually start" (as opposed to start_time,
    which includes the formation/grid lap). Used by both build_timeline (race_start_time, for
    the scrubber marker) and build_bulk_timing (the FORMATION -> LAP 1 transition) so the two
    can't drift apart from being computed two different ways.
    """
    result = await db.execute(
        select(func.min(LapEvent.timestamp))
        .where(LapEvent.race_id == race_id, LapEvent.lap_number == 1)
    )
    return result.scalar()


async def build_timeline(race_id: str, db: AsyncSession) -> dict | None:
    """Returns None if race not found."""
    result = await db.execute(
        select(func.min(Event.timestamp), func.max(Event.timestamp))
        .where(Event.race_id == race_id)
    )
    row = result.one()
    if row[0] is None:
        return None
    start_time = await _first_motion_ts(race_id, db) or row[0]
    total_laps_row = await db.execute(
        select(func.max(LapEvent.lap_number)).where(LapEvent.race_id == race_id)
    )
    total_laps = total_laps_row.scalar()
    return {
        "start_time": start_time,
        "end_time": row[1],
        "duration": row[1] - start_time,
        "total_laps": total_laps,
        "race_start_time": await _race_start_ts(race_id, db),
    }


async def build_bulk_states(race_id: str, db: AsyncSession, step: int = 1) -> list[dict] | None:
    """Returns None if race not found."""
    timeline_result = await db.execute(
        select(func.min(Event.timestamp), func.max(Event.timestamp))
        .where(Event.race_id == race_id)
    )
    row = timeline_result.one()
    if row[0] is None:
        return None
    motion_ts = await _first_motion_ts(race_id, db)
    start_ts = int(motion_ts if motion_ts is not None else row[0])
    end_ts = int(row[1])

    events_result = await db.execute(
        select(Event.driver_id, Event.timestamp, Event.x, Event.y, Event.speed)
        .where(Event.race_id == race_id)
        .order_by(Event.timestamp)
    )
    events = events_result.all()

    current_cars: dict[str, dict] = {}
    event_idx = 0
    states = []

    for t in range(start_ts, end_ts + 1, step):
        while event_idx < len(events) and events[event_idx].timestamp <= t:
            e = events[event_idx]
            current_cars[e.driver_id] = {"x": e.x, "y": e.y, "speed": e.speed}
            event_idx += 1
        states.append({"timestamp": float(t), "cars": {k: dict(v) for k, v in current_cars.items()}})

    return states


async def build_bulk_timing(race_id: str, db: AsyncSession) -> list[dict] | None:
    """Returns None if race not found."""
    timeline_result = await db.execute(
        select(func.min(Event.timestamp), func.max(Event.timestamp))
        .where(Event.race_id == race_id)
    )
    row = timeline_result.one()
    if row[0] is None:
        return None
    motion_ts = await _first_motion_ts(race_id, db)
    start_ts = int(motion_ts if motion_ts is not None else row[0])
    end_ts = int(row[1])

    pos_events = (await db.execute(
        select(PositionEvent.driver_id, PositionEvent.timestamp, PositionEvent.position)
        .where(PositionEvent.race_id == race_id).order_by(PositionEvent.timestamp)
    )).all()

    int_events = (await db.execute(
        select(IntervalEvent.driver_id, IntervalEvent.timestamp,
               IntervalEvent.gap_to_leader, IntervalEvent.interval)
        .where(IntervalEvent.race_id == race_id).order_by(IntervalEvent.timestamp)
    )).all()

    lap_events = (await db.execute(
        select(LapEvent.driver_id, LapEvent.timestamp, LapEvent.lap_number,
               LapEvent.lap_duration, LapEvent.compound, LapEvent.tyre_age_at_start)
        .where(LapEvent.race_id == race_id).order_by(LapEvent.timestamp)
    )).all()

    raw_results = (await db.execute(
        select(SessionResult.driver_id, SessionResult.dnf, SessionResult.dns,
               SessionResult.dsq, SessionResult.number_of_laps)
        .where(SessionResult.race_id == race_id)
    )).all()

    retirements: dict[str, dict] = {}
    for r in raw_results:
        if r.dnf or r.dns or r.dsq:
            reason = "DSQ" if r.dsq else ("DNS" if r.dns else "DNF")
            # number_of_laps is None when the classification isn't tied to a lap the driver
            # stopped at — e.g. a post-race technical DSQ, where the driver raced the full
            # distance and was excluded afterward. Coercing that to 0 would flip their status
            # right after lap 3 instead of near the end of the race, so it's preserved as None
            # and handled separately below.
            retirements[r.driver_id] = {"reason": reason, "n_laps": r.number_of_laps, "dns": r.dns}

    lap_start_by_number: dict[int, float] = {}
    for e in lap_events:
        if e.lap_number not in lap_start_by_number or e.timestamp < lap_start_by_number[e.lap_number]:
            lap_start_by_number[e.lap_number] = e.timestamp

    # OpenF1's race_control lap counter (current_race_lap below) ticks to 1 as soon as the
    # formation lap begins — not a reliable "race actually started" signal, and can precede
    # any real lap data by tens of minutes on a delayed start. Whether any driver has actually
    # completed lap 1 yet is what determines whether there's real data to show. Uses the same
    # _race_start_ts() as build_timeline's race_start_time so the FORMATION->LAP 1 transition
    # and the scrubber marker can't drift apart from being computed two different ways.
    lap1_completed_ts = await _race_start_ts(race_id, db)

    q_phases = (await db.execute(
        select(QualifyingPhase.phase, QualifyingPhase.start_ts, QualifyingPhase.end_ts)
        .where(QualifyingPhase.race_id == race_id)
        .where(QualifyingPhase.end_ts.is_not(None))
        .order_by(QualifyingPhase.phase)
    )).all()

    phase_resets = sorted(
        [(qp.phase, qp.start_ts) for qp in q_phases if qp.phase > 1],
        key=lambda x: x[1],
    )
    reset_idx = 0

    phase_start_by_num = {qp.phase: qp.start_ts for qp in q_phases}

    PHASE_CUTOFF = {1: 16, 2: 11}

    eliminations: dict[str, tuple[int, float]] = {}
    for qp in q_phases:
        if qp.phase >= 3 or qp.end_ts is None:
            continue
        already_out = set(eliminations)
        cutoff_ts = phase_start_by_num.get(qp.phase + 1, qp.end_ts)
        pos_at_end: dict[str, int] = {}
        for e in pos_events:
            if e.timestamp > cutoff_ts:
                break
            if e.driver_id not in already_out:
                pos_at_end[e.driver_id] = e.position
        min_elim_pos = PHASE_CUTOFF.get(qp.phase, 16)
        for driver_id, pos in pos_at_end.items():
            if pos >= min_elim_pos:
                eliminations[driver_id] = (qp.phase, cutoff_ts)

    deleted_times: dict[str, set[float]] = {}
    session_key_val = (await db.execute(
        select(RaceSession.session_key).where(RaceSession.race_id == race_id)
    )).scalar_one_or_none()
    rc_lap_events: list[tuple[float, int]] = []
    if session_key_val:
        try:
            rc_events = await fetch_race_control(session_key_val)
            for ev in rc_events:
                msg = ev.get("message", "")
                if "DELETED" not in msg.upper():
                    continue
                parsed = _parse_deleted_time_and_driver(msg)
                if parsed is not None:
                    acronym, lap_time = parsed
                    deleted_times.setdefault(acronym, set()).add(round(lap_time, 3))
            for ev in rc_events:
                ln = ev.get("lap_number")
                if ln is None:
                    continue
                try:
                    ts = datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).timestamp()
                    rc_lap_events.append((ts, int(ln)))
                except (KeyError, ValueError):
                    pass
            rc_lap_events.sort(key=lambda x: x[0])
        except Exception as exc:
            print(f"  Could not fetch deleted lap times for {race_id}: {exc}")

    driver_state: dict[str, dict] = {}
    tyre_base: dict[str, tuple[int, int]] = {}
    session_best: float | None = None

    # A driver who never started has no position/interval/lap events at all, so they'd never
    # get a driver_state entry and would be missing from the tower entirely. Seed a static
    # placeholder row for them — no stored grid/qualifying position exists to show, so they
    # sort to the bottom via the existing status=="out" sort key.
    telemetry_driver_ids = (
        {e.driver_id for e in pos_events}
        | {e.driver_id for e in int_events}
        | {e.driver_id for e in lap_events}
    )
    phantom_dns_standings = [
        {
            "driver_id": r.driver_id,
            "position": None,
            "gap_to_leader": None,
            "interval": None,
            "last_lap_duration": None,
            "best_lap_duration": None,
            "lap_number": 0,
            "compound": None,
            "tyre_age": 0,
            "is_fastest_lap": False,
            "status": "out",
            "eliminated_in_phase": None,
            "out_reason": "DNS",
        }
        for r in raw_results
        if r.dns and r.driver_id not in telemetry_driver_ids
    ]

    pos_idx = int_idx = lap_idx = rc_lap_idx = 0
    current_race_lap: int | None = None
    frames = []

    for t in range(start_ts, end_ts + 1, 1):
        while reset_idx < len(phase_resets) and t >= int(phase_resets[reset_idx][1]):
            for driver_id, ds in driver_state.items():
                if driver_id not in eliminations:
                    ds.pop("best_lap_duration", None)
            session_best = None
            reset_idx += 1

        while rc_lap_idx < len(rc_lap_events) and rc_lap_events[rc_lap_idx][0] <= t:
            current_race_lap = rc_lap_events[rc_lap_idx][1]
            rc_lap_idx += 1

        while pos_idx < len(pos_events) and pos_events[pos_idx].timestamp <= t:
            e = pos_events[pos_idx]
            elim = eliminations.get(e.driver_id)
            if elim is None or e.timestamp <= elim[1]:
                driver_state.setdefault(e.driver_id, {})["position"] = e.position
            pos_idx += 1

        while int_idx < len(int_events) and int_events[int_idx].timestamp <= t:
            e = int_events[int_idx]
            elim = eliminations.get(e.driver_id)
            if elim is None or e.timestamp <= elim[1]:
                ds = driver_state.setdefault(e.driver_id, {})
                ds["gap_to_leader"] = e.gap_to_leader
                ds["interval"] = e.interval
            int_idx += 1

        while lap_idx < len(lap_events) and lap_events[lap_idx].timestamp <= t:
            e = lap_events[lap_idx]
            elim = eliminations.get(e.driver_id)
            if elim is None or e.timestamp <= elim[1]:
                ds = driver_state.setdefault(e.driver_id, {})
                ds["last_lap_duration"] = e.lap_duration
                ds["lap_number"] = e.lap_number
                if e.compound and e.compound != ds.get("compound"):
                    tyre_base[e.driver_id] = (e.lap_number, e.tyre_age_at_start or 0)
                ds["compound"] = e.compound
                if e.lap_duration is not None:
                    lap_deleted = round(e.lap_duration, 3) in deleted_times.get(e.driver_id, set())
                    if not lap_deleted:
                        prev_best = ds.get("best_lap_duration")
                        if prev_best is None or e.lap_duration < prev_best:
                            ds["best_lap_duration"] = e.lap_duration
                    if not lap_deleted and (session_best is None or e.lap_duration < session_best):
                        session_best = e.lap_duration
            lap_idx += 1

        if not driver_state:
            continue

        standings = []
        for driver_id, ds in driver_state.items():
            lap_num = ds.get("lap_number") or 0
            base_lap, base_age = tyre_base.get(driver_id, (lap_num, 0))
            tyre_age = base_age + max(0, lap_num - base_lap)
            best = ds.get("best_lap_duration")
            is_fastest = (best is not None and session_best is not None
                          and abs(best - session_best) < 0.001)
            elim = eliminations.get(driver_id)
            is_eliminated = elim is not None and t >= int(elim[1])
            standings.append({
                "driver_id": driver_id,
                "position": ds.get("position"),
                "gap_to_leader": ds.get("gap_to_leader"),
                "interval": ds.get("interval"),
                "last_lap_duration": ds.get("last_lap_duration"),
                "best_lap_duration": best,
                "lap_number": lap_num,
                "compound": ds.get("compound"),
                "tyre_age": tyre_age,
                "is_fastest_lap": is_fastest,
                "status": "eliminated" if is_eliminated else "active",
                "eliminated_in_phase": elim[0] if is_eliminated else None,
                "out_reason": None,
            })
        standings.extend(phantom_dns_standings)

        for standing in standings:
            ret = retirements.get(standing["driver_id"])
            if ret is None:
                continue
            if ret["dns"]:
                # Never started — out from the very beginning of the timeline, not a
                # lap-based or end-of-race cutoff.
                is_out = True
            else:
                n_laps = ret["n_laps"]
                if n_laps is None:
                    # Not tied to a lap they stopped at (e.g. post-race DSQ) — only reflect it
                    # in the final moments of the timeline, not from wherever lap 3 happens to be.
                    cutoff_ts = end_ts - 60
                else:
                    cutoff_ts = lap_start_by_number.get(n_laps + 3)
                is_out = cutoff_ts is not None and t >= int(cutoff_ts)
            if is_out:
                standing["status"] = "out"
                standing["out_reason"] = ret["reason"]

        standings.sort(key=lambda s: (
            s["status"] == "out",
            s["status"] == "eliminated",
            s["position"] is None,
            s["position"] or 9999,
        ))
        standings_max_lap = max((ds.get("lap_number") or 0 for ds in driver_state.values()), default=0)
        race_started = lap1_completed_ts is not None and t >= lap1_completed_ts
        # 0 means no driver has completed lap 1 yet (formation/grid/delayed start) — not
        # "unknown". Frontend renders 0 as "FORMATION" instead of "LAP 0/N".
        effective_race_lap = max(current_race_lap or 0, standings_max_lap) if race_started else 0
        frames.append({"timestamp": float(t), "standings": standings, "race_lap": effective_race_lap})

    return frames


async def build_scrub_buffer(race_id: str, db: AsyncSession) -> list[dict] | None:
    """Returns None if race not found."""
    timeline_result = await db.execute(
        select(func.min(Event.timestamp), func.max(Event.timestamp))
        .where(Event.race_id == race_id)
    )
    row = timeline_result.one()
    if row[0] is None:
        return None
    motion_ts = await _first_motion_ts(race_id, db)
    start_ts = int(motion_ts if motion_ts is not None else row[0])
    end_ts = int(row[1])

    raw_events = (await db.execute(
        select(Event.driver_id, Event.timestamp, Event.x, Event.y)
        .where(Event.race_id == race_id)
        .order_by(Event.timestamp)
    )).all()

    pos_events = (await db.execute(
        select(PositionEvent.driver_id, PositionEvent.timestamp, PositionEvent.position)
        .where(PositionEvent.race_id == race_id)
        .order_by(PositionEvent.timestamp)
    )).all()

    lap_events_scrub = (await db.execute(
        select(LapEvent.timestamp, LapEvent.lap_number)
        .where(LapEvent.race_id == race_id)
        .order_by(LapEvent.timestamp)
    )).all()

    current_cars: dict[str, list] = {}
    current_pos: dict[str, int] = {}
    current_lap: int | None = None
    event_idx = 0
    pos_idx = 0
    lap_idx = 0
    frames = []

    for t in range(start_ts, end_ts + 1, 5):
        while event_idx < len(raw_events) and raw_events[event_idx].timestamp <= t:
            e = raw_events[event_idx]
            current_cars[e.driver_id] = [e.x, e.y]
            event_idx += 1
        while pos_idx < len(pos_events) and pos_events[pos_idx].timestamp <= t:
            e = pos_events[pos_idx]
            current_pos[e.driver_id] = e.position
            pos_idx += 1
        while lap_idx < len(lap_events_scrub) and lap_events_scrub[lap_idx].timestamp <= t:
            ln = lap_events_scrub[lap_idx].lap_number
            if ln is not None and (current_lap is None or ln > current_lap):
                current_lap = ln
            lap_idx += 1
        if current_cars:
            frames.append({
                "t": t,
                "cars": {k: list(v) for k, v in current_cars.items()},
                "pos": dict(current_pos),
                "lap": current_lap,
            })

    return frames


async def build_track(race_id: str, db: AsyncSession) -> list[dict] | None:
    """Returns None if race not found. Each point is {"x": float, "y": float}."""
    result = await db.execute(
        select(Event.driver_id, Event.timestamp, Event.x, Event.y)
        .where(Event.race_id == race_id, Event.x.is_not(None), Event.y.is_not(None),
               Event.x != 0, Event.y != 0)
        .order_by(Event.driver_id, Event.timestamp)
    )
    events = result.all()
    if not events:
        return None

    GRID_SIZE = 50
    MIN_DRIVERS = 2

    grid: dict[tuple, set] = {}
    events_by_driver: dict[str, list] = {}
    for row in events:
        cell = (int(row.x / GRID_SIZE), int(row.y / GRID_SIZE))
        if cell not in grid:
            grid[cell] = set()
        grid[cell].add(row.driver_id)
        if row.driver_id not in events_by_driver:
            events_by_driver[row.driver_id] = []
        events_by_driver[row.driver_id].append(row)

    consensus = {cell for cell, drivers in grid.items() if len(drivers) >= MIN_DRIVERS}

    def consensus_score(driver_id: str) -> float:
        pts = events_by_driver[driver_id]
        if not pts:
            return 0.0
        on_circuit = sum(
            1 for r in pts
            if (int(r.x / GRID_SIZE), int(r.y / GRID_SIZE)) in consensus
        )
        return on_circuit / len(pts)

    ref_driver = max(events_by_driver, key=consensus_score)
    return [{"x": r.x, "y": r.y} for r in events_by_driver[ref_driver]]


async def build_driver_colors(race_id: str, db: AsyncSession) -> dict[str, str] | None:
    """Returns None if race not found."""
    result = await db.execute(
        select(RaceSession.session_key).where(RaceSession.race_id == race_id)
    )
    session_key = result.scalar_one_or_none()
    if session_key is None:
        return None

    drivers = await _get(f"{BASE_URL}/drivers", {"session_key": session_key})
    return {
        d["name_acronym"]: f"#{d['team_colour']}"
        for d in drivers
        if d.get("name_acronym") and d.get("team_colour")
    }
