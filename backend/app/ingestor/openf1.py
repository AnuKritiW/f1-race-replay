import asyncio
import httpx

BASE_URL = "https://api.openf1.org/v1"


async def _get(url: str, params: dict) -> list[dict]:
    async with httpx.AsyncClient(timeout=60.0) as client:
        for attempt in range(5):
            r = await client.get(url, params=params)
            if r.status_code == 429:
                wait = 2 ** attempt
                print(f"  429 rate limit, retrying in {wait}s...")
                await asyncio.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        r.raise_for_status()
        return []


async def fetch_sessions(year: int, country_name: str) -> list[dict]:
    return await _get(f"{BASE_URL}/sessions", {"year": year, "country_name": country_name})


async def fetch_drivers(session_key: int) -> list[dict]:
    return await _get(f"{BASE_URL}/drivers", {"session_key": session_key})


async def fetch_location(session_key: int, driver_number: int) -> list[dict]:
    records = await _get(f"{BASE_URL}/location", {"session_key": session_key, "driver_number": driver_number})
    return [
        {"date": rec["date"], "x": rec.get("x"), "y": rec.get("y"), "speed": rec.get("speed"), "_raw": rec}
        for rec in records
    ]
