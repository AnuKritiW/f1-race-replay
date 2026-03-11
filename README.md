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
