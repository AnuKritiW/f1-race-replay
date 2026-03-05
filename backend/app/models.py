import uuid
from datetime import datetime, timezone

from sqlalchemy import Float, String, JSON, DateTime, Index, PrimaryKeyConstraint, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    race_id: Mapped[str] = mapped_column(String, nullable=False)
    timestamp: Mapped[float] = mapped_column(Float, nullable=False)
    driver_id: Mapped[str] = mapped_column(String, nullable=False)
    x: Mapped[float | None] = mapped_column(Float, nullable=True)
    y: Mapped[float | None] = mapped_column(Float, nullable=True)
    speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        Index("ix_events_race_timestamp", "race_id", "timestamp"),
        Index("ix_events_race_driver", "race_id", "driver_id"),
        UniqueConstraint("race_id", "driver_id", "timestamp", name="uq_events_race_driver_timestamp"),
    )


class Snapshot(Base):
    __tablename__ = "snapshots"

    race_id: Mapped[str] = mapped_column(String, nullable=False)
    timestamp: Mapped[float] = mapped_column(Float, nullable=False)
    state_json: Mapped[dict] = mapped_column(JSON, nullable=False)

    __table_args__ = (
        PrimaryKeyConstraint("race_id", "timestamp"),
    )
