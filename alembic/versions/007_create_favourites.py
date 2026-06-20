"""create favourites table

Revision ID: 007
Revises: 006
Create Date: 2026-06-20
"""

from typing import Sequence, Union

from alembic import op

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE favourites (
            id SERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            station_id TEXT NOT NULL REFERENCES stations(station_id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (user_id, station_id)
        )
    """)
    op.execute("CREATE INDEX ix_favourites_user_id ON favourites (user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE favourites")
