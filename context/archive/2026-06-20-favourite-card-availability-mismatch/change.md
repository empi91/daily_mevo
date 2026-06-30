---
change_id: favourite-card-availability-mismatch
title: Investigate and fix availability values on favourite station cards
status: archived
created: 2026-06-20
updated: 2026-06-20
archived_at: 2026-06-20T19:03:19Z
---

## Notes

gh issue #33 [B-05] — Favourite card availability values may not match actual data.

Quick manual check suggests the availability numbers displayed on favourite station cards on the homepage don't match expected values from the collected data. Needs investigation: data source (same aggregation as station detail page?), time window used, day-of-week alignment, timezone handling, possible caching layer, and a direct comparison between card display vs station detail page vs raw DB query for a sample of stations.
