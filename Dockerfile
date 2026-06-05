FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.12-slim
RUN groupadd -r mevo && useradd -r -g mevo -d /app -s /sbin/nologin mevo
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY app/ app/
COPY alembic/ alembic/
COPY alembic.ini ./
COPY scripts/entrypoint.sh ./
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
USER mevo
EXPOSE 8000
CMD ["./entrypoint.sh"]
