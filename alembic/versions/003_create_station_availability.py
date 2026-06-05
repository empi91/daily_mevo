"""create station_availability table

Revision ID: 003
Revises: 002
Create Date: 2026-06-05
"""

from typing import Sequence, Union

from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE station_availability (
            station_id TEXT NOT NULL REFERENCES stations(station_id),
            day_of_week SMALLINT NOT NULL,
            time_slot TIME NOT NULL,
            avg_bikes DOUBLE PRECISION NOT NULL DEFAULT 0,
            avg_ebikes DOUBLE PRECISION NOT NULL DEFAULT 0,
            sample_count INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (station_id, day_of_week, time_slot)
        )
    """)
    op.execute(
        "CREATE INDEX idx_station_availability_station ON station_availability (station_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE station_availability")
