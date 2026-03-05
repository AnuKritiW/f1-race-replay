from pydantic import BaseModel


class CarState(BaseModel):
    x: float | None
    y: float | None
    speed: float | None


class RaceState(BaseModel):
    timestamp: float
    cars: dict[str, CarState]


class RaceTimeline(BaseModel):
    start_time: float
    end_time: float
    duration: float


class TrackPoint(BaseModel):
    x: float
    y: float


class IngestResponse(BaseModel):
    race_id: str
    events_inserted: int
    snapshots_written: int
