---
change_id: testing-api-auth
title: API and auth integration tests (test plan phase 2)
status: implementing
created: 2026-06-16
updated: 2026-06-16
archived_at: null
---

## Notes

Phase 2 of the test plan rollout. Prove endpoints return correct data and auth flows work end-to-end. Covers risks #3 (station API returns incorrect/empty/stale data), #4 (auth flow breaks in production), and #7 (unvalidated user input in search/geocode). Integration tests using FastAPI TestClient with seeded DB, cookie-aware auth, and adversarial input.
