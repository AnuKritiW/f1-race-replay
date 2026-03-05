# f1-race-replay

A web-based F1 race replay tool that animates car positions from historical telemetry data.

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

## Seed data

In a separate terminal, once all services are running:

```bash
bash scripts/seed.sh
```

This waits for the backend to be healthy, then ingests the Singapore 2023 Practice 1 session from OpenF1. Ingestion takes ~1–2 minutes depending on network speed.

## Open the UI

```
http://localhost:5173
```

The track map renders car positions for the seeded session. Use Play, the scrubber, and the speed buttons (1×, 5×, 10×) to replay the session.

## API

| Endpoint | Description |
|---|---|
| `GET /health` | Health check |
| `GET /races/{race_id}/timeline` | Session start/end times |
| `GET /races/{race_id}/state?at=<timestamp>` | Car positions at a given time |
| `GET /races/{race_id}/track` | Circuit outline points |
| `POST /admin/races/{race_id}/ingest?session_key=<key>` | Ingest a session from OpenF1 |
