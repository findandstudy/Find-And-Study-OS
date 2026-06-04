---
name: Prod→Dev data copy (faithful mirror)
description: Reliable read-only-prod → writable-dev row copy technique, and the silent-skip gotcha that makes per-table count verification mandatory.
---

# Copying production rows into the dev database

**Why this exists:** A "full" prod→dev copy once reported success while silently
skipping the entire inbox/messaging cluster (conversations, external_contacts,
messages, notifications). The app looked nearly empty in dev even though the copy
"succeeded". Never trust a bulk copy's success flag.

## Hard rule
After any prod→dev copy, verify **per-table `count(*)`** prod vs dev for every
table you intended to copy, and re-copy any shortfall. A single aggregate total
hides per-table gaps.

## Constraints in this environment
- Prod is reachable ONLY read-only via `executeSql({environment:"production"})`.
  There are no prod credentials in the dev container, so node/pg cannot connect to
  prod directly. Dev is writable via `executeSql({environment:"development"})`.
- Prod `pg_stat_user_tables.n_live_tup` is all 0 (prod never ANALYZEd) — use exact
  `count(*)` for prod, not n_live_tup. Dev n_live_tup is fine after ANALYZE.

## Reliable transfer method (preserves jsonb/timestamps/arrays exactly)
1. Read on prod as base64'd JSON (strip the newlines pg's base64 inserts):
   `SELECT replace(replace(encode(convert_to(json_agg(x)::text,'UTF8'),'base64'),E'\n',''),E'\r','') FROM (SELECT * FROM "T" ORDER BY id LIMIT n OFFSET m) x`
   Decode + `JSON.parse` in code_execution. base64 avoids CSV/quote/newline corruption.
2. Write on dev with `json_populate_recordset` so the table's own rowtype coerces
   every column (jsonb, timestamptz, arrays) by key name — column order/extra keys
   don't matter:
   `INSERT INTO "T" SELECT * FROM json_populate_recordset(NULL::"T", '<json>'::json)`
3. To bypass FK + triggers during load, wrap in a single multi-statement call:
   `BEGIN; SET LOCAL session_replication_role=replica; <insert>; COMMIT;`
   `params` cannot be used with multi-statement, so embed the JSON as a literal and
   escape `'`→`''` (standard_conforming_strings is on, so backslashes are literal —
   no other escaping needed). The dev role HAS permission to set replica role.
4. After inserting explicit serial ids, reset each sequence:
   `SELECT setval(pg_get_serial_sequence('public."T"','id'), GREATEST(max(id),1))`.
5. `ANALYZE` the copied tables (replica-role bulk load does not update planner stats).

## Faithful-mirror caveat
The dev copy mirrors prod warts and all: prod itself had dangling FKs (conversations
194/831 → channel_accounts 1170/1770 that don't exist in prod) and lots of e2e
"Playwright Inbox" / `inbox_*@e2e.test` residue. Those reappear in dev and are NOT
copy defects — don't chase them. The e2e teardown only deletes rows matching
`inbox\_%@e2e.test`, so it never wipes real prod data.
