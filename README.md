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

## Seed data (optional)

To pre-load a session without using the UI:

```bash
bash scripts/seed.sh
```

This ingests the Singapore 2023 Practice 1 session from OpenF1.

## API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/sessions` | All ingested sessions |
| GET | `/races/{race_id}/timeline` | Session start/end timestamps |
| GET | `/races/{race_id}/states` | Bulk position buffer (one frame/second) |
| GET | `/races/{race_id}/timing` | Bulk timing buffer (one frame/second) |
| GET | `/races/{race_id}/track` | Circuit outline points |
| GET | `/races/{race_id}/drivers` | Driver → team colour map |
| GET | `/admin/sessions/available?year=` | OpenF1 sessions with ingested flag |
| POST | `/admin/sessions/ingest` | Start background ingest → 202 |
| GET | `/admin/sessions/{race_id}/progress` | `{done, total}` ingest progress |
| DELETE | `/admin/sessions/{race_id}/ingest` | Cancel in-progress ingest |
| DELETE | `/admin/sessions/{race_id}` | Delete all data for a session |
