from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.database import AsyncSessionLocal
from app.models import Event, Snapshot


async def build_snapshots(race_id: str, interval_seconds: float = 30.0) -> int:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Event)
            .where(Event.race_id == race_id)
            .order_by(Event.timestamp)
        )
        events = result.scalars().all()

    if not events:
        print(f"No events found for race_id='{race_id}'")
        return 0

    snapshots = []
    current_cars: dict[str, dict] = {}
    next_snapshot_t = events[0].timestamp

    for event in events:
        if event.x is not None and event.y is not None:
            current_cars[event.driver_id] = {
                "x": event.x,
                "y": event.y,
                "speed": event.speed,
            }

        if event.timestamp >= next_snapshot_t and current_cars:
            snapshots.append({
                "race_id": race_id,
                "timestamp": next_snapshot_t,
                "state_json": {"cars": dict(current_cars)},
            })
            next_snapshot_t += interval_seconds

    async with AsyncSessionLocal() as session:
        stmt = (
            insert(Snapshot)
            .values(snapshots)
            .on_conflict_do_nothing()
        )
        await session.execute(stmt)
        await session.commit()

    print(f"Wrote {len(snapshots)} snapshots from t={snapshots[0]['timestamp']:.1f} to t={snapshots[-1]['timestamp']:.1f}")
    return len(snapshots)
