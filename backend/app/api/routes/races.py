from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import Response
import json
from sqlalchemy import delete, select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, get_db
from app.models import Event, RaceSession, Snapshot
from app.schemas import (
    AvailableSession, CarState, IngestRequest, RaceState, RaceTimeline,
    SessionInfo, TrackPoint, IngestResponse,
)
from app.ingestor.loader import load_race
from app.ingestor.openf1 import BASE_URL, _get, fetch_sessions
from app.snapshot.builder import build_snapshots

router = APIRouter()

_bulk_states_cache: dict[str, bytes] = {}
_track_cache: dict[str, list] = {}
_ingest_state: dict[str, dict] = {}
# { race_id: { 'total': int, 'done': int, 'status': 'running'|'cancelled'|'done' } }


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


@router.get("/races/{race_id}/timeline", response_model=RaceTimeline)
async def get_timeline(race_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(func.min(Event.timestamp), func.max(Event.timestamp))
        .where(Event.race_id == race_id)
    )
    row = result.one()
    if row[0] is None:
        raise HTTPException(status_code=404, detail=f"Race '{race_id}' not found")
    start_time = await _first_motion_ts(race_id, db) or row[0]
    return RaceTimeline(start_time=start_time, end_time=row[1], duration=row[1] - start_time)


@router.get("/races/{race_id}/state", response_model=RaceState)
async def get_state(
    race_id: str,
    at: float = Query(..., description="Unix timestamp"),
    db: AsyncSession = Depends(get_db),
):
    # Nearest snapshot <= at
    snap_result = await db.execute(
        select(Snapshot)
        .where(Snapshot.race_id == race_id, Snapshot.timestamp <= at)
        .order_by(Snapshot.timestamp.desc())
        .limit(1)
    )
    snapshot = snap_result.scalar_one_or_none()

    if snapshot is None:
        cars: dict[str, CarState] = {}
        base_ts = 0.0
    else:
        cars = {
            driver: CarState(**pos)
            for driver, pos in snapshot.state_json["cars"].items()
        }
        base_ts = snapshot.timestamp

    # Apply events between snapshot.timestamp and at
    events_result = await db.execute(
        select(Event)
        .where(
            Event.race_id == race_id,
            Event.timestamp > base_ts,
            Event.timestamp <= at,
        )
        .order_by(Event.timestamp)
    )
    for event in events_result.scalars().all():
        cars[event.driver_id] = CarState(x=event.x, y=event.y, speed=event.speed)

    return RaceState(timestamp=at, cars=cars)


@router.get("/races/{race_id}/states")
async def get_bulk_states(
    race_id: str,
    step: int = Query(1, ge=1, description="Interval in seconds between states"),
    db: AsyncSession = Depends(get_db),
):
    """Return a state snapshot for every `step` seconds across the full race."""
    cache_key = f"{race_id}:{step}"
    if cache_key in _bulk_states_cache:
        return Response(content=_bulk_states_cache[cache_key], media_type="application/json")

    timeline_result = await db.execute(
        select(func.min(Event.timestamp), func.max(Event.timestamp))
        .where(Event.race_id == race_id)
    )
    row = timeline_result.one()
    if row[0] is None:
        raise HTTPException(status_code=404, detail=f"Race '{race_id}' not found")
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

    content = json.dumps(states).encode()
    _bulk_states_cache[cache_key] = content
    return Response(content=content, media_type="application/json")


@router.get("/races/{race_id}/live", response_model=RaceState)
async def get_live(race_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Snapshot)
        .where(Snapshot.race_id == race_id)
        .order_by(Snapshot.timestamp.desc())
        .limit(1)
    )
    snapshot = result.scalar_one_or_none()
    if snapshot is None:
        raise HTTPException(status_code=404, detail=f"Race '{race_id}' not found")

    cars = {
        driver: CarState(**pos)
        for driver, pos in snapshot.state_json["cars"].items()
    }
    return RaceState(timestamp=snapshot.timestamp, cars=cars)


@router.get("/races/{race_id}/drivers")
async def get_driver_colors(race_id: str, db: AsyncSession = Depends(get_db)):
    """Return {acronym: '#rrggbb'} for every driver in this session, sourced from OpenF1."""
    result = await db.execute(
        select(RaceSession.session_key).where(RaceSession.race_id == race_id)
    )
    session_key = result.scalar_one_or_none()
    if session_key is None:
        raise HTTPException(status_code=404, detail=f"Race '{race_id}' not found")

    drivers = await _get(f"{BASE_URL}/drivers", {"session_key": session_key})
    return {
        d["name_acronym"]: f"#{d['team_colour']}"
        for d in drivers
        if d.get("name_acronym") and d.get("team_colour")
    }


@router.get("/races/{race_id}/track", response_model=list[TrackPoint])
async def get_track(race_id: str, db: AsyncSession = Depends(get_db)):
    if race_id in _track_cache:
        return _track_cache[race_id]
    # Load x/y/driver for all drivers to build a consensus grid, then pick
    # the reference driver whose path stays most on-circuit (highest fraction
    # of points in cells shared by multiple drivers). This avoids anomalous
    # excursions (crashes, off-track incidents) corrupting the track shape.
    result = await db.execute(
        select(Event.driver_id, Event.timestamp, Event.x, Event.y)
        .where(Event.race_id == race_id, Event.x.is_not(None), Event.y.is_not(None),
               Event.x != 0, Event.y != 0)
        .order_by(Event.driver_id, Event.timestamp)
    )
    events = result.all()
    if not events:
        raise HTTPException(status_code=404, detail=f"Race '{race_id}' not found")

    GRID_SIZE = 50
    MIN_DRIVERS = 2

    # Build consensus grid: cells visited by at least MIN_DRIVERS distinct drivers
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

    # Score each driver by fraction of their points that fall in consensus cells.
    # The driver with the cleanest on-circuit path scores highest.
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

    rows = events_by_driver[ref_driver]
    points = [TrackPoint(x=r.x, y=r.y) for r in rows]
    _track_cache[race_id] = points
    return points


@router.get("/sessions", response_model=list[SessionInfo])
async def list_sessions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(RaceSession).order_by(RaceSession.year.desc(), RaceSession.date_start))
    sessions = result.scalars().all()
    return [
        SessionInfo(
            race_id=s.race_id,
            session_key=s.session_key,
            session_name=s.session_name,
            session_type=s.session_type,
            event_name=s.event_name,
            year=s.year,
            date_start=s.date_start,
            country_name=s.country_name,
        )
        for s in sessions
    ]


@router.get("/admin/sessions/available", response_model=list[AvailableSession])
async def list_available_sessions(
    year: int = Query(..., description="Season year"),
    db: AsyncSession = Depends(get_db),
):
    openf1_sessions = await fetch_sessions(year)

    result = await db.execute(select(RaceSession.session_key, RaceSession.race_id))
    ingested = {row.session_key: row.race_id for row in result.all()}

    return [
        AvailableSession(
            session_key=s["session_key"],
            session_name=s.get("session_name", ""),
            session_type=s.get("session_type", ""),
            event_name=s.get("meeting_name", s.get("country_name", "")),
            year=s.get("year", year),
            date_start=s.get("date_start", ""),
            country_name=s.get("country_name", ""),
            circuit_short_name=s.get("circuit_short_name", s.get("location", "")),
            ingested=s["session_key"] in ingested,
            race_id=ingested.get(s["session_key"]),
        )
        for s in openf1_sessions
        if "session_key" in s
    ]


async def _run_ingest(race_id: str, session_key: int) -> None:
    _ingest_state[race_id] = {"total": 0, "done": 0, "status": "running"}

    def on_driver_done(done: int, total: int) -> None:
        _ingest_state[race_id]["done"] = done
        _ingest_state[race_id]["total"] = total

    def is_cancelled() -> bool:
        return _ingest_state.get(race_id, {}).get("status") == "cancelled"

    try:
        sessions = await _get(f"{BASE_URL}/sessions", {"session_key": session_key})
        meta = sessions[0] if sessions else {}

        events_inserted = await load_race(
            race_id, session_key,
            on_driver_done=on_driver_done,
            is_cancelled=is_cancelled,
        )

        if is_cancelled():
            print(f"Ingest cancelled: {race_id}")
            return

        await build_snapshots(race_id)

        async with AsyncSessionLocal() as db:
            existing = await db.execute(
                select(RaceSession).where(RaceSession.race_id == race_id)
            )
            if existing.scalar_one_or_none() is None:
                db.add(RaceSession(
                    race_id=race_id,
                    session_key=session_key,
                    session_name=meta.get("session_name", ""),
                    session_type=meta.get("session_type", ""),
                    event_name=meta.get("meeting_name", meta.get("country_name", "")),
                    year=meta.get("year", 0),
                    date_start=meta.get("date_start", ""),
                    country_name=meta.get("country_name", ""),
                ))
                await db.commit()

        _ingest_state[race_id]["status"] = "done"
        print(f"Ingest complete: {race_id} — {events_inserted} events")
    except Exception as e:
        _ingest_state[race_id]["status"] = "error"
        print(f"Ingest error: {race_id} — {e}")


@router.post("/admin/sessions/ingest", status_code=202)
async def ingest_session(
    body: IngestRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(RaceSession).where(RaceSession.race_id == body.race_id)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail=f"race_id '{body.race_id}' already ingested")

    background_tasks.add_task(_run_ingest, body.race_id, body.session_key)
    return {"race_id": body.race_id, "status": "ingesting"}


@router.get("/admin/sessions/ingest/active")
async def get_active_ingests():
    """Return all currently running ingestions as {race_id: {done, total}}."""
    return {
        race_id: {"done": state["done"], "total": state["total"]}
        for race_id, state in _ingest_state.items()
        if state["status"] == "running"
    }


@router.get("/admin/sessions/{race_id}/progress")
async def get_ingest_progress(race_id: str):
    state = _ingest_state.get(race_id)
    if state is None:
        raise HTTPException(status_code=404, detail="No ingest found for this race_id")
    return state


@router.delete("/admin/sessions/{race_id}/ingest", status_code=200)
async def cancel_ingest(race_id: str):
    state = _ingest_state.get(race_id)
    if state is None or state["status"] != "running":
        raise HTTPException(status_code=404, detail="No active ingest for this race_id")
    _ingest_state[race_id]["status"] = "cancelled"
    return {"race_id": race_id, "status": "cancelled"}


@router.delete("/admin/sessions/{race_id}", status_code=200)
async def delete_session(race_id: str, db: AsyncSession = Depends(get_db)):
    """Delete all ingested data for a session."""
    existing = await db.execute(select(RaceSession).where(RaceSession.race_id == race_id))
    if existing.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"No ingested session '{race_id}'")

    await db.execute(delete(Event).where(Event.race_id == race_id))
    await db.execute(delete(Snapshot).where(Snapshot.race_id == race_id))
    await db.execute(delete(RaceSession).where(RaceSession.race_id == race_id))
    await db.commit()

    _bulk_states_cache.pop(race_id, None)
    _track_cache.pop(race_id, None)
    _ingest_state.pop(race_id, None)

    return {"race_id": race_id, "status": "deleted"}


@router.post("/admin/races/{race_id}/ingest", response_model=IngestResponse)
async def ingest_race(
    race_id: str,
    session_key: int = Query(..., description="OpenF1 session key"),
):
    events_inserted = await load_race(race_id, session_key)
    snapshots_written = await build_snapshots(race_id)
    return IngestResponse(
        race_id=race_id,
        events_inserted=events_inserted,
        snapshots_written=snapshots_written,
    )
