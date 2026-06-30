---
change_id: testing-data-integrity
title: Data integrity tests for aggregation, collector, and GBFS contract
status: archived
created: 2026-06-16
updated: 2026-06-18
archived_at: 2026-06-18T20:37:15Z
---

## Notes

Test plan Phase 1: prove the numbers are correct and the pipeline stays alive. Covers Risk #1 (collector dies / stale data), Risk #2 (incorrect aggregation averages), and Risk #6 (GBFS API format changes undetected). Test types: unit tests for aggregation math, integration tests for collector-to-DB flow, contract test for GBFS schema validation.
