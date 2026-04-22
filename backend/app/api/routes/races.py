from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Security
from fastapi.responses import Response
from fastapi.security.api_key import APIKeyHeader
import json
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal, get_db
from app.models import Event, IntervalEvent, LapEvent, PositionEvent, QualifyingPhase, RaceSession, SessionResult, Snapshot
from app.schemas import (
    AvailableSession, CarState, IngestRequest, RaceState, RaceTimeline,
    SessionInfo, TrackPoint, IngestResponse,
)
from app.ingestor.loader import load_race, load_timing
from app.ingestor.openf1 import BASE_URL, _get, fetch_sessions
from app.snapshot.builder import build_snapshots
import app.services.races as svc

limiter = Limiter(key_func=get_remote_address)
_admin_key_header = APIKeyHeader(name="X-Admin-Key", auto_error=False)


def _require_admin(key: str = Security(_admin_key_header)):
    if key != settings.admin_key:
        raise HTTPException(status_code=403, detail="Invalid or missing admin key")


router = APIRouter()

_bulk_states_cache: dict[str, bytes] = {}
_bulk_timing_cache: dict[str, bytes] = {}
_track_cache: dict[str, list] = {}
_ingest_state: dict[str, dict] = {}
_scrub_cache: dict[str, bytes] = {}
_bulk_states_list_cache: dict[str, list] = {}
_bulk_timing_list_cache: dict[str, list] = {}


@router.get("/races/{race_id}/timeline", response_model=RaceTimeline)
@limiter.limit("60/minute")
async def get_timeline(request: Request, race_id: str, db: AsyncSession = Depends(get_db)):
    data = await svc.build_timeline(race_id, db)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Race '{race_id}' not found")
    return RaceTimeline(**data)


@router.get("/races/{race_id}/state", response_model=RaceState)
@limiter.limit("60/minute")
async def get_state(
    request: Request,
    race_id: str,
    at: float = Query(..., description="Unix timestamp"),
    db: AsyncSession = Depends(get_db),
):
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
@limiter.limit("20/minute")
async def get_bulk_states(
    request: Request,
    race_id: str,
    step: int = Query(1, ge=1, description="Interval in seconds between states"),
    from_ts: float | None = Query(None, alias="from"),
    to_ts: float | None = Query(None, alias="to"),
    db: AsyncSession = Depends(get_db),
):
    cache_key = f"{race_id}:{step}"
    if cache_key not in _bulk_states_cache:
        states = await svc.build_bulk_states(race_id, db, step)
        if states is None:
            raise HTTPException(status_code=404, detail=f"Race '{race_id}' not found")
        _bulk_states_cache[cache_key] = json.dumps(states).encode()
        _bulk_states_list_cache[cache_key] = states

    if from_ts is not None or to_ts is not None:
        states_list = _bulk_states_list_cache.get(cache_key)
        if states_list is None:
            states_list = json.loads(_bulk_states_cache[cache_key])
            _bulk_states_list_cache[cache_key] = states_list
        filtered = [
            s for s in states_list
            if (from_ts is None or s["timestamp"] >= from_ts)
            and (to_ts is None or s["timestamp"] <= to_ts)
        ]
        return Response(content=json.dumps(filtered).encode(), media_type="application/json")

    return Response(content=_bulk_states_cache[cache_key], media_type="application/json")


@router.get("/races/{race_id}/timing")
@limiter.limit("20/minute")
async def get_bulk_timing(
    request: Request,
    race_id: str,
    from_ts: float | None = Query(None, alias="from"),
    to_ts: float | None = Query(None, alias="to"),
    db: AsyncSession = Depends(get_db),
):
    if race_id not in _bulk_timing_cache:
        frames = await svc.build_bulk_timing(race_id, db)
        if frames is None:
            raise HTTPException(status_code=404, detail=f"Race '{race_id}' not found")
        _bulk_timing_cache[race_id] = json.dumps(frames).encode()
        _bulk_timing_list_cache[race_id] = frames

    if from_ts is not None or to_ts is not None:
        timing_list = _bulk_timing_list_cache.get(race_id)
        if timing_list is None:
            timing_list = json.loads(_bulk_timing_cache[race_id])
            _bulk_timing_list_cache[race_id] = timing_list
        filtered = [
            f for f in timing_list
            if (from_ts is None or f["timestamp"] >= from_ts)
            and (to_ts is None or f["timestamp"] <= to_ts)
        ]
        return Response(content=json.dumps(filtered).encode(), media_type="application/json")

    return Response(content=_bulk_timing_cache[race_id], media_type="application/json")


@router.get("/races/{race_id}/scrub")
@limiter.limit("20/minute")
async def get_scrub_buffer(request: Request, race_id: str, db: AsyncSession = Depends(get_db)):
    if race_id in _scrub_cache:
        return Response(content=_scrub_cache[race_id], media_type="application/json")
    frames = await svc.build_scrub_buffer(race_id, db)
    if frames is None:
        raise HTTPException(status_code=404, detail=f"Race '{race_id}' not found")
    content = json.dumps(frames).encode()
    _scrub_cache[race_id] = content
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
@limiter.limit("20/minute")
async def get_driver_colors(request: Request, race_id: str, db: AsyncSession = Depends(get_db)):
    colors = await svc.build_driver_colors(race_id, db)
    if colors is None:
        raise HTTPException(status_code=404, detail=f"Race '{race_id}' not found")
    return colors


@router.get("/races/{race_id}/track", response_model=list[TrackPoint])
@limiter.limit("20/minute")
async def get_track(request: Request, race_id: str, db: AsyncSession = Depends(get_db)):
    if race_id in _track_cache:
        return _track_cache[race_id]
    points = await svc.build_track(race_id, db)
    if points is None:
        raise HTTPException(status_code=404, detail=f"Race '{race_id}' not found")
    _track_cache[race_id] = points
    return points


@router.get("/sessions", response_model=list[SessionInfo])
@limiter.limit("60/minute")
async def list_sessions(request: Request, db: AsyncSession = Depends(get_db)):
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
    _: None = Depends(_require_admin),
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
        if "session_key" in s and s.get("session_name") not in ("Day 1", "Day 2", "Day 3")
    ]


async def _run_ingest(race_id: str, session_key: int) -> None:
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

        timing_counts = await load_timing(race_id, session_key, is_cancelled=is_cancelled)
        if is_cancelled():
            print(f"Ingest cancelled during timing: {race_id}")
            return
        print(f"  Timing: {timing_counts}")

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
    _: None = Depends(_require_admin),
):
    existing = await db.execute(
        select(RaceSession).where(RaceSession.race_id == body.race_id)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail=f"race_id '{body.race_id}' already ingested")

    _ingest_state[body.race_id] = {"total": 0, "done": 0, "status": "running"}
    background_tasks.add_task(_run_ingest, body.race_id, body.session_key)
    return {"race_id": body.race_id, "status": "ingesting"}


@router.get("/admin/sessions/ingest/active")
async def get_active_ingests(_: None = Depends(_require_admin)):
    return {
        race_id: {"done": state["done"], "total": state["total"]}
        for race_id, state in _ingest_state.items()
        if state["status"] == "running"
    }


@router.get("/admin/sessions/{race_id}/progress")
async def get_ingest_progress(race_id: str, _: None = Depends(_require_admin)):
    state = _ingest_state.get(race_id)
    if state is None:
        raise HTTPException(status_code=404, detail="No ingest found for this race_id")
    return state


@router.delete("/admin/sessions/{race_id}/ingest", status_code=200)
async def cancel_ingest(race_id: str, _: None = Depends(_require_admin)):
    state = _ingest_state.get(race_id)
    if state is None or state["status"] != "running":
        raise HTTPException(status_code=404, detail="No active ingest for this race_id")
    _ingest_state[race_id]["status"] = "cancelled"
    return {"race_id": race_id, "status": "cancelled"}


@router.delete("/admin/sessions/{race_id}", status_code=200)
async def delete_session(race_id: str, db: AsyncSession = Depends(get_db), _: None = Depends(_require_admin)):
    existing = await db.execute(select(RaceSession).where(RaceSession.race_id == race_id))
    if existing.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"No ingested session '{race_id}'")

    await db.execute(delete(Event).where(Event.race_id == race_id))
    await db.execute(delete(Snapshot).where(Snapshot.race_id == race_id))
    await db.execute(delete(PositionEvent).where(PositionEvent.race_id == race_id))
    await db.execute(delete(IntervalEvent).where(IntervalEvent.race_id == race_id))
    await db.execute(delete(LapEvent).where(LapEvent.race_id == race_id))
    await db.execute(delete(QualifyingPhase).where(QualifyingPhase.race_id == race_id))
    await db.execute(delete(SessionResult).where(SessionResult.race_id == race_id))
    await db.execute(delete(RaceSession).where(RaceSession.race_id == race_id))
    await db.commit()

    _bulk_states_cache.pop(race_id, None)
    _bulk_timing_cache.pop(race_id, None)
    _track_cache.pop(race_id, None)
    _ingest_state.pop(race_id, None)
    _scrub_cache.pop(race_id, None)
    _bulk_states_list_cache.pop(f"{race_id}:1", None)
    _bulk_timing_list_cache.pop(race_id, None)

    return {"race_id": race_id, "status": "deleted"}


@router.post("/admin/races/{race_id}/ingest", response_model=IngestResponse)
async def ingest_race(
    race_id: str,
    session_key: int = Query(..., description="OpenF1 session key"),
    _: None = Depends(_require_admin),
):
    events_inserted = await load_race(race_id, session_key)
    snapshots_written = await build_snapshots(race_id)
    return IngestResponse(
        race_id=race_id,
        events_inserted=events_inserted,
        snapshots_written=snapshots_written,
    )
