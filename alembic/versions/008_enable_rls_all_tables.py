"""enable row-level security on all tables

Supabase exposes a public PostgREST API; without RLS any table in the
public schema is readable/writable via the anon key. Enabling RLS with
no permissive policies blocks that access. The app connects via asyncpg
as the postgres (superuser) role, which bypasses RLS.

Revision ID: 008
Revises: 007
Create Date: 2026-06-28
"""

from typing import Sequence, Union

from alembic import op

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = [
    "stations",
    "snapshots",
    "station_availability",
    "agg_watermark",
    "users",
    "db_size_log",
    "favourites",
]


def upgrade() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
