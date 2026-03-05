"""add unique constraint to events race_id driver_id timestamp

Revision ID: 879faa16c15f
Revises: 84e250df6d3f
Create Date: 2026-03-05 12:53:33.947453

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '879faa16c15f'
down_revision: Union[str, Sequence[str], None] = '84e250df6d3f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_events_race_driver_timestamp",
        "events",
        ["race_id", "driver_id", "timestamp"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_events_race_driver_timestamp", "events", type_="unique")
