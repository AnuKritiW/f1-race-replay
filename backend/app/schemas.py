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
    total_laps: int | None = None
    race_start_time: float | None = None


class TrackPoint(BaseModel):
    x: float
    y: float


class IngestResponse(BaseModel):
    race_id: str
    events_inserted: int
    snapshots_written: int


class SessionInfo(BaseModel):
    race_id: str
    session_key: int
    session_name: str
    session_type: str
    event_name: str
    year: int
    date_start: str
    country_name: str


class AvailableSession(BaseModel):
    session_key: int
    session_name: str
    session_type: str
    event_name: str
    year: int
    date_start: str
    country_name: str
    circuit_short_name: str
    ingested: bool
    race_id: str | None = None


class IngestRequest(BaseModel):
    race_id: str
    session_key: int
