---
change_id: data-pipeline-performance
title: Optimize station sync and aggregation for scalability
status: archived
created: 2026-06-11
updated: 2026-06-13
archived_at: 2026-06-13T20:51:40Z
---

## Notes

Analyze gh issues E-04 and E-03 (both related to data collection/database values calculations). E-03 (#14): station sync takes 46-200s per run, needs bulk upsert to get under 10s. E-04 (#15): aggregation query does full GROUP BY over entire snapshots table, will degrade as table grows (~240K rows/day). Must preserve data correctness, idempotency, and stay within 768MB memory budget on Mikr.us.
