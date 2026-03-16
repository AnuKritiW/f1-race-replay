#!/usr/bin/env python3
"""Ingest all sessions for a given year sequentially.

Usage:
    python scripts/ingest_year.py 2025
    python scripts/ingest_year.py 2025 --only-types Race Qualifying
"""
import argparse
import sys
import time
import urllib.request
import urllib.error
import json
import re

BASE = "http://localhost:8000"


def get(path):
    with urllib.request.urlopen(f"{BASE}{path}") as r:
        return json.loads(r.read())


def post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{BASE}{path}", data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code


SESSION_CODE_MAP = {
    "Practice 1": "p1",
    "Practice 2": "p2",
    "Practice 3": "p3",
    "Qualifying": "q",
    "Race": "r",
    "Sprint": "s",
    "Sprint Qualifying": "sq",
    "Sprint Shootout": "sq",
    "Day 1": "d1",
    "Day 2": "d2",
    "Day 3": "d3",
}


def make_race_id(session: dict) -> str:
    country = re.sub(r"[^a-z0-9]+", "-", (session.get("circuit_short_name") or session["country_name"]).lower()).strip("-")
    year = session["year"]
    code = SESSION_CODE_MAP.get(session["session_name"])
    if code is None:
        code = re.sub(r"[^a-z0-9]+", "-", session["session_name"].lower()).strip("-")
    return f"{country}-{year}-{code}"


def is_ingested(race_id: str) -> bool:
    try:
        sessions = get("/sessions")
        return any(s["race_id"] == race_id for s in sessions)
    except Exception:
        return False


def wait_for_completion(race_id: str) -> bool:
    while True:
        try:
            state = get(f"/admin/sessions/{race_id}/progress")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                # Backend restarted and lost in-memory state — check DB directly
                if is_ingested(race_id):
                    print(f"\r  [done] (recovered from backend restart)" + " " * 10)
                    return True
                print(f"\n  404: ingest state lost and session not in DB — treating as failed")
                return False
            print(f"\n  Poll error: {e}")
            time.sleep(5)
            continue
        except Exception as e:
            print(f"\n  Poll error: {e}")
            time.sleep(5)
            continue

        status = state.get("status")
        done = state.get("done", 0)
        total = state.get("total", 0)
        progress = f"{done}/{total} drivers" if total else "starting..."

        print(f"\r  [{status}] {progress}" + " " * 10, end="", flush=True)

        if status == "done":
            print()
            return True
        if status in ("error", "cancelled"):
            print()
            return False

        time.sleep(3)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("year", type=int)
    parser.add_argument(
        "--only-types",
        nargs="+",
        metavar="TYPE",
        help="e.g. --only-types Race Qualifying Sprint",
    )
    args = parser.parse_args()

    print(f"Fetching available sessions for {args.year}...")
    sessions = get(f"/admin/sessions/available?year={args.year}")

    to_ingest = [s for s in sessions if not s["ingested"] and s["session_name"] not in ("Day 1", "Day 2", "Day 3")]

    if args.only_types:
        allowed = {t.lower() for t in args.only_types}
        to_ingest = [s for s in to_ingest if s["session_type"].lower() in allowed]

    if not to_ingest:
        print("Nothing to ingest.")
        return

    print(f"{len(to_ingest)} session(s) to ingest:\n")
    for s in to_ingest:
        print(f"  [{s['session_key']}] {s['event_name']} — {s['session_name']} ({s['session_type']})")
    print()

    failed = []
    for i, s in enumerate(to_ingest, 1):
        race_id = make_race_id(s)
        label = f"{s['event_name']} {s['session_name']}"
        print(f"[{i}/{len(to_ingest)}] {label}  →  {race_id}")

        body, status = post("/admin/sessions/ingest", {"race_id": race_id, "session_key": s["session_key"]})
        if status == 409:
            print(f"  Already ingested, skipping.")
            continue
        if status != 202:
            print(f"  Failed to start ingest: {status} {body}")
            failed.append(race_id)
            continue

        ok = wait_for_completion(race_id)
        if not ok:
            print(f"  FAILED: {race_id}")
            failed.append(race_id)
        else:
            print(f"  Done.")

    print()
    if failed:
        print(f"Failed sessions: {failed}")
        sys.exit(1)
    else:
        print("All sessions ingested successfully.")


if __name__ == "__main__":
    main()
