from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
import json
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Event, Snapshot
from app.schemas import CarState, RaceState, RaceTimeline, TrackPoint, IngestResponse
from app.ingestor.loader import load_race
from app.snapshot.builder import build_snapshots

router = APIRouter()

_bulk_states_cache: dict[str, bytes] = {}


@router.get("/races/{race_id}/timeline", response_model=RaceTimeline)
async def get_timeline(race_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(func.min(Event.timestamp), func.max(Event.timestamp))
        .where(Event.race_id == race_id)
    )
    row = result.one()
    if row[0] is None:
        raise HTTPException(status_code=404, detail=f"Race '{race_id}' not found")
    return RaceTimeline(start_time=row[0], end_time=row[1], duration=row[1] - row[0])


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
    start_ts, end_ts = int(row[0]), int(row[1])

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


@router.get("/races/{race_id}/track", response_model=list[TrackPoint])
async def get_track(race_id: str, db: AsyncSession = Depends(get_db)):
    # Pick one driver to trace the circuit in lap order
    driver_result = await db.execute(
        select(Event.driver_id)
        .where(Event.race_id == race_id)
        .limit(1)
    )
    driver = driver_result.scalar_one_or_none()
    if driver is None:
        raise HTTPException(status_code=404, detail=f"Race '{race_id}' not found")

    result = await db.execute(
        select(Event.x, Event.y)
        .where(Event.race_id == race_id, Event.driver_id == driver, Event.x != 0, Event.y != 0)
        .order_by(Event.timestamp)
    )
    rows = result.all()
    return [TrackPoint(x=row[0], y=row[1]) for row in rows]


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
