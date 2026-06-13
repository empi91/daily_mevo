"""create agg_watermark table

Revision ID: 004
Revises: 003
Create Date: 2026-06-13
"""

from typing import Sequence, Union

from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE agg_watermark (
            id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            last_processed_id BIGINT NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        INSERT INTO agg_watermark (id, last_processed_id)
        VALUES (1, (SELECT COALESCE(MAX(id), 0) FROM snapshots))
    """)


def downgrade() -> None:
    op.execute("DROP TABLE agg_watermark")
