from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Event, Snapshot
from app.schemas import CarState, RaceState, RaceTimeline, TrackPoint, IngestResponse
from app.ingestor.loader import load_race
from app.snapshot.builder import build_snapshots

router = APIRouter()


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
    result = await db.execute(
        select(distinct(Event.x), Event.y)
        .where(Event.race_id == race_id, Event.x != 0, Event.y != 0)
        .order_by(Event.x, Event.y)
        .limit(5000)
    )
    rows = result.all()
    if not rows:
        raise HTTPException(status_code=404, detail=f"Race '{race_id}' not found")
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
