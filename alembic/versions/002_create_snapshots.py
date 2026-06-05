"""create snapshots table

Revision ID: 002
Revises: 001
Create Date: 2026-06-05
"""

from typing import Sequence, Union

from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE snapshots (
            id BIGSERIAL PRIMARY KEY,
            station_id TEXT NOT NULL REFERENCES stations(station_id),
            collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            bikes_available INTEGER NOT NULL,
            ebikes_available INTEGER NOT NULL,
            docks_available INTEGER NOT NULL,
            is_installed BOOLEAN NOT NULL DEFAULT TRUE,
            is_renting BOOLEAN NOT NULL DEFAULT TRUE,
            is_returning BOOLEAN NOT NULL DEFAULT TRUE
        )
    """)
    op.execute(
        "CREATE INDEX idx_snapshots_station_collected ON snapshots (station_id, collected_at)"
    )
    op.execute("CREATE INDEX idx_snapshots_collected_at ON snapshots (collected_at)")


def downgrade() -> None:
    op.execute("DROP TABLE snapshots")
