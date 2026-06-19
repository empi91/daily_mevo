"""create db_size_log table

Revision ID: 006
Revises: 005
Create Date: 2026-06-19
"""

from typing import Sequence, Union

from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE db_size_log (
            id SERIAL PRIMARY KEY,
            recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            size_bytes BIGINT NOT NULL
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE db_size_log")
