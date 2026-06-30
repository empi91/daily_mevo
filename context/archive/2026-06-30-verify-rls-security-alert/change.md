---
change_id: verify-rls-security-alert
title: Verify and resolve Supabase RLS security alert
status: archived
created: 2026-06-30
updated: 2026-06-30
archived_at: 2026-06-30T18:44:28Z
---

## Notes

Supabase emailed a critical security alert on 2026-06-30 (findings "as of 28 Jun 2026") reporting `rls_disabled_in_public` on the daily-mevo project. Investigated whether the existing RLS migrations (008, 009) had been applied. Confirmed via SQL query and Supabase Security Advisor that RLS is enabled on all 8 public tables. The remaining advisory ("RLS enabled but no policies") is expected — the app connects as postgres superuser (bypasses RLS) and intentionally has zero policies to lock out PostgREST/anon access.
