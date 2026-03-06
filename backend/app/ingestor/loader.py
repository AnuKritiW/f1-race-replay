import asyncio
from collections.abc import Callable
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.database import AsyncSessionLocal
from app.models import Event
from app.ingestor.openf1 import fetch_drivers, fetch_location


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
