# f1-race-replay

A web-based F1 race replay tool that animates car positions from historical telemetry data, with a real-time timing tower showing gaps, intervals, lap times, tyre compounds, and qualifying elimination groups.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose

## Start

```bash
docker compose up --build
```

This starts three services:
- **postgres** on port 5432
- **backend** (FastAPI) on port 8000
- **frontend** (Vite + React) on port 5173

## Open the UI

```
http://localhost:5173
```

Pick a year, find a session, and click **Ingest**. Ingestion takes 1–3 minutes depending on session length and network speed. Once complete, the session is available for replay.

The track map renders car positions with smooth interpolation. Use Play, the scrubber, and the speed buttons (1×, 5×, 10×) to replay. The timing tower on the right updates in sync with the playhead.

Playback uses a two-tier buffer: a lightweight scrub buffer (~530 KB) loads immediately so you can drag the timeline right away, while full-resolution 5-minute tiles (~3.3 MB each) load on demand as you play or settle the scrubber. Memory stays bounded — tiles more than ±2 from the playhead are evicted automatically.

## Seed data (optional)

To pre-load a session without using the UI:

```bash
bash scripts/seed.sh
```

This ingests the Singapore 2023 Practice 1 session from OpenF1.

## Schema migrations

Database schema is managed with Alembic. Migration files live in `backend/alembic/versions/` and are committed to the repo.

**When you change `models.py`** (add a table, column, index, etc.):

```bash
# 1. Generate a migration by diffing your models against the local dev DB
docker exec f1-race-replay-backend-1 uv run alembic revision --autogenerate -m "describe the change"

# 2. Copy the generated file from the container to the host
docker cp f1-race-replay-backend-1:/app/alembic/versions/<new_file>.py backend/alembic/versions/

# 3. Review the file, then commit it alongside your models.py change

# 4. Apply to local dev DB
docker exec f1-race-replay-backend-1 uv run alembic upgrade head

# 5. Apply to RDS (swap in the RDS connection string)
DATABASE_URL=postgresql+asyncpg://<user>:<pass>@<rds-host>:5432/<db> \
  uv run alembic upgrade head
```

The `alembic_version` table in each database tracks which migration was last applied. `upgrade head` only runs what's missing, so it's safe to run on any DB at any revision.

**Check current state:**

```bash
docker exec f1-race-replay-backend-1 uv run alembic current   # what revision the DB is at
docker exec f1-race-replay-backend-1 uv run alembic check     # whether any models are out of sync
```

## Database

All data lives in Postgres. Every table is keyed by `race_id` (format: `singapore-2023-r`).

| Table | What it stores | Where it's used |
|-------|---------------|-----------------|
| `race_sessions` | One row per ingested session — name, type, year, country, OpenF1 session key | Session picker; `/sessions` endpoint |
| `events` | Raw car telemetry — x/y position and speed per driver per timestamp | Source data for building states and the track outline; largest table (~300k–500k rows per race) |
| `snapshots` | Pre-computed car state every 30 seconds, stored as JSON blobs | Fast initial state lookup without scanning all events |
| `position_events` | Race position (1st, 2nd…) per driver over time | Timing tower standings |
| `interval_events` | Gap to leader and gap to car ahead per driver over time | Timing tower gap/interval columns |
| `lap_events` | One row per completed lap — lap time, tyre compound, tyre age | Timing tower lap times and tyre info |
| `session_results` | Final result per driver — DNF, DNS, DSQ, laps completed | Timing tower retirement/status markers |
| `qualifying_phases` | Q1/Q2/Q3 start and end timestamps | Timing tower elimination group logic (qualifying sessions only) |

## API

| Method | Endpoint | Description | Response shape |
|---|---|---|---|
| GET | `/health` | Health check | `{"status": "ok"}` |
| GET | `/sessions` | All ingested sessions | `[{race_id, session_key, session_name, session_type, event_name, year, date_start, country_name}]` |
| GET | `/races/{race_id}/timeline` | Session start/end timestamps | `{start, end}` |
| GET | `/races/{race_id}/scrub` | Position-only scrub buffer (one frame/5s) | `[{t, cars: {driver_id: [x, y]}, pos: {driver_id: position}}]` |
| GET | `/races/{race_id}/states?from=&to=` | Position buffer; optional `from`/`to` unix timestamps for tile slice | `[{timestamp, cars: {driver_id: {x, y}}}]` |
| GET | `/races/{race_id}/timing?from=&to=` | Timing buffer; optional `from`/`to` unix timestamps for tile slice | `[{timestamp, race_lap, standings: [{driver_id, position, gap_to_leader, interval, last_lap_duration, best_lap_duration, compound, tyre_age, is_fastest_lap, status, eliminated_in_phase, out_reason}]}]` |
| GET | `/races/{race_id}/track` | Circuit outline points | `[{x, y}]` |
| GET | `/races/{race_id}/drivers` | Driver → team colour map | `{driver_id: hex_colour}` |
| GET | `/admin/sessions/available?year=` | OpenF1 sessions with ingested flag | `[{session_key, session_name, session_type, event_name, year, country_name, ingested, race_id}]` |
| POST | `/admin/sessions/ingest` | Start background ingest → 202 | `{race_id, status}` |
| GET | `/admin/sessions/{race_id}/progress` | `{done, total}` ingest progress | `{done, total, status}` |
| DELETE | `/admin/sessions/{race_id}/ingest` | Cancel in-progress ingest | `{race_id, status}` |
| DELETE | `/admin/sessions/{race_id}` | Delete all data for a session | `{race_id, status}` |
