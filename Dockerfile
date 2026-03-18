# ── Stage 1: Build React frontend ────────────────────────────────────────────
FROM node:20-alpine AS frontend

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ .

RUN npm run build

# ── Stage 2: Python backend + static files ────────────────────────────────────
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

COPY backend/pyproject.toml backend/uv.lock* ./
RUN uv sync --frozen --no-dev

COPY backend/ .

# Copy built frontend into static/ where main.py expects it
COPY --from=frontend /app/dist ./static

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
