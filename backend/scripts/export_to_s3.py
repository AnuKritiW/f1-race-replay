#!/usr/bin/env python3
"""
Export all ingested sessions to S3 as static JSON files for CloudFront delivery.

Usage (from backend/):
    S3_BUCKET=f1-replay-static-data AWS_PROFILE=f1-replay-deploy .venv/bin/python scripts/export_to_s3.py

    # Export specific race IDs only:
    S3_BUCKET=f1-replay-static-data AWS_PROFILE=f1-replay-deploy .venv/bin/python scripts/export_to_s3.py monaco-2023-r bahrain-2024-r

Files written per race_id:
    {race_id}/timeline.json
    {race_id}/states.json
    {race_id}/timing.json
    {race_id}/scrub.json
    {race_id}/track.json
    {race_id}/drivers.json

Plus a top-level:
    sessions.json
"""
import asyncio
import json
import os
import sys

import boto3
from sqlalchemy import select

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import AsyncSessionLocal
from app.models import RaceSession
import app.services.races as svc

S3_BUCKET = os.environ["S3_BUCKET"]


def upload(s3, key: str, data: list | dict) -> None:
    body = json.dumps(data).encode()
    s3.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=body,
        ContentType="application/json",
    )
    kb = len(body) // 1024
    print(f"  {key}  ({kb}KB)")


async def export_race(race_id: str, s3) -> bool:
    print(f"\n{race_id}")
    async with AsyncSessionLocal() as db:
        timeline = await svc.build_timeline(race_id, db)
        if timeline is None:
            print("  SKIP: no data")
            return False

        states  = await svc.build_bulk_states(race_id, db, step=1)
        timing  = await svc.build_bulk_timing(race_id, db)
        scrub   = await svc.build_scrub_buffer(race_id, db)
        track   = await svc.build_track(race_id, db)
        drivers = await svc.build_driver_colors(race_id, db)

    upload(s3, f"{race_id}/timeline.json", timeline)
    upload(s3, f"{race_id}/states.json",   states or [])
    upload(s3, f"{race_id}/timing.json",   timing or [])
    upload(s3, f"{race_id}/scrub.json",    scrub  or [])
    upload(s3, f"{race_id}/track.json",    track  or [])
    upload(s3, f"{race_id}/drivers.json",  drivers or {})
    return True


async def main(race_ids: list[str] | None = None) -> None:
    s3 = boto3.client("s3")

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(RaceSession).order_by(RaceSession.year.desc(), RaceSession.date_start)
        )
        sessions = result.scalars().all()

    sessions_data = [
        {
            "race_id":      s.race_id,
            "session_key":  s.session_key,
            "session_name": s.session_name,
            "session_type": s.session_type,
            "event_name":   s.event_name,
            "year":         s.year,
            "date_start":   s.date_start,
            "country_name": s.country_name,
        }
        for s in sessions
    ]
    print("sessions.json")
    upload(s3, "sessions.json", sessions_data)

    targets = race_ids if race_ids else [s.race_id for s in sessions]
    for race_id in targets:
        await export_race(race_id, s3)

    print("\nDone.")


if __name__ == "__main__":
    race_ids = sys.argv[1:] or None
    asyncio.run(main(race_ids))
