"""
Standalone test: ingest Bahrain 2024 race session, build snapshots, and print results.

Run from backend/ directory:
    uv run python scripts/test_ingest.py
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select, asc

from app.database import AsyncSessionLocal
from app.models import Event
from app.ingestor.loader import load_race
from app.snapshot.builder import build_snapshots

RACE_ID = "bahrain-2024"
SESSION_KEY = 9158


async def main() -> None:
    print(f"Loading session {SESSION_KEY} into race_id='{RACE_ID}' ...")
    await load_race(RACE_ID, SESSION_KEY)

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Event)
            .where(Event.race_id == RACE_ID)
            .order_by(asc(Event.timestamp))
            .limit(10)
        )
        events = result.scalars().all()

    print(f"\nFirst {len(events)} events in DB:")
    for e in events:
        print(f"  {e.driver_id:>4}  t={e.timestamp:.3f}  x={e.x}  y={e.y}  speed={e.speed}")

    print(f"\nBuilding snapshots for race_id='{RACE_ID}' ...")
    await build_snapshots(RACE_ID)


if __name__ == "__main__":
    asyncio.run(main())
