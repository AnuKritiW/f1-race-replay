FROM python:3.12-slim

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Copy dependency files first so Docker can cache this layer separately.
# If only app code changes, uv sync is skipped on rebuild.
COPY pyproject.toml .
COPY uv.lock* .

# Install dependencies into the system Python (no virtualenv needed in a container)
RUN uv sync --frozen --no-dev

# Copy the rest of the application
COPY . .

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
