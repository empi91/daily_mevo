# MevoStats Frontend

React + TypeScript + Vite frontend for MevoStats.

## Development

Start the Vite dev server (proxies `/api` to the backend on port 8000):

```bash
cd frontend
npm install
npm run dev
```

Backend must be running separately:

```bash
uv run uvicorn app.main:app --reload
```

Open http://localhost:5173 — API calls are proxied to the backend automatically.

## Production

The Docker build handles everything — no manual frontend build needed:

```bash
docker compose build
docker compose up
```

The Dockerfile uses a multi-stage build: Node.js compiles the frontend, then the built files are copied into the Python runtime image. FastAPI serves them as static files with SPA fallback.

## Type checking

```bash
npm run typecheck
```
