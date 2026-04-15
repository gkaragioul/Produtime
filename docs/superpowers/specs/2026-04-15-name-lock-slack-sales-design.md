# Name Lock, Admin-Managed Identity, and Slack Sales Dashboard — Design

**Date:** 2026-04-15
**Author:** George Karagioules
**Scope:** ProduTime client, admin-web, admin-console, WOT_Slack_Bot

## Goal

1. Lock employee name on ProduTime client after first entry — only the admin can change it afterwards.
2. Add a Slack User ID field on the admin side; push it to the client read-only.
3. Show per-agent Slack sales stats (day/week/month counters + recent tickets) in the ProduTime dashboard's currently-empty right column, and move Focus Summary into the left column underneath the Current Activity card.

## Non-Goals

- Tracking "active / pre-resolution" tickets (open threads without a won/lost reaction). Only resolved cases are shown.
- Any change to how the Slack bot posts to `#sales-aggregate` — we add persistence alongside, not a rewrite.
- Exposing the Slack bot to the public internet. All new endpoints are internal and key-gated.

---

## Section 1 — Data Model & Sync

### New fields

| Field | Location | Type | Owner | Notes |
|---|---|---|---|---|
| `employee_name` | client `settings` table | string | client (seeded) | Already exists. |
| `employee_name_locked` | client `settings` table | bool (`"true"`/`"false"`) | client | New. Set `true` on first user save. Cleared when admin pushes empty name. |
| `slack_user_id` | client `settings` table | string | admin-pushed | Read-only on client. |
| `display_name` | admin-web `devices` table | string, nullable | admin | New column (migration). |
| `slack_user_id` | admin-web `devices` table | string, nullable | admin | New column (migration). |

### Protocol additions

`src/shared/admin-protocol.ts` — `PolicyData`:
```ts
interface PolicyData {
  // ...existing
  employeeName?: string;
  slackUserId?: string; // new
}
```

### Sync rules

- **Client first-time save:** writes `employee_name` + `employee_name_locked="true"` to local DB; sends on next heartbeat.
- **Admin edit in Devices tab:** writes to admin DB `devices.display_name` / `devices.slack_user_id`; triggers `POLICY_PUSH` with both fields; client overwrites local values (admin always wins; lock does **not** block admin-originated writes).
- **Admin clears name** (empty string pushed): client clears `employee_name_locked` so the user can re-enter. Explicit operator action.
- **Existing installs** (migration on upgrade): if `employee_name` is already set and `employee_name_locked` is unset, set it to `"true"`.

---

## Section 2 — UI Changes

### ProduTime client — Settings

- `SettingsTab.tsx` / `PolicyView.tsx` Name input:
  - If `employee_name_locked === "true"` → input is `disabled`, with a small tooltip: "Locked — contact your admin to change."
  - Save button hidden/disabled in locked state.
- New read-only row below Name: **Slack User ID** — shown only when populated. Muted style, non-editable.

### ProduTime client — Dashboard (`ActivityDashboard.tsx`)

Layout change:

- **Left column (~60%):**
  1. Current Activity card (unchanged).
  2. **Focus Summary** — moved here from right column. Full column width.
  3. "Show Recent Activity" collapsible — preserves current list underneath Focus Summary.
- **Right column (~40%):** new `SalesStatsPanel` component.
  - Header: "Sales".
  - Segmented control: **Today** / **This Week** / **This Month**.
  - Counter row: Wins, Losses, Win rate (%), Total € won.
  - Recent tickets list (last 10 within selected range): client name · destination · outcome badge · amount · relative timestamp.
  - Empty states: "No tickets yet" (range empty), "Ask your admin to link your Slack account." (unconfigured), "Sales data unavailable" with retry (unreachable).

### Admin Console — Devices tab (`DeviceList.tsx`)

- New **Edit** button per row.
- Modal with two inputs: **Display Name** (text), **Slack User ID** (text, e.g. `U01ABCDEF`). Save button.
- Row renders Slack User ID as a small muted label under the IP when set.

---

## Section 3 — Sales Data Pipeline

### WOT_Slack_Bot — persistence

New SQLite table `sales_cases` (bot-side DB):

```sql
CREATE TABLE sales_cases (
  thread_key      TEXT PRIMARY KEY,  -- "{channel_id}:{thread_ts}"
  agent_user_id   TEXT NOT NULL,     -- Slack user_id of the agent
  outcome         TEXT NOT NULL,     -- "won" | "lost"
  final_amount    REAL,
  currency        TEXT,
  client_name     TEXT,
  destination     TEXT,
  resolved_at     TEXT NOT NULL,     -- ISO8601 UTC
  source_channel  TEXT NOT NULL,
  permalink       TEXT,
  raw_json        TEXT NOT NULL
);
CREATE INDEX idx_sales_agent_time ON sales_cases(agent_user_id, resolved_at DESC);
```

- Insert point: the existing moneybag/stop-sign reaction handler in `sales_case_normalizer.py`, immediately before posting to `#sales-aggregate`. Use `INSERT OR IGNORE` on `thread_key` to remain idempotent and match the existing Redis dedup behavior.
- One-time backfill script (`scripts/backfill_sales_cases.py`) walks `#sales-aggregate` history via Slack Web API, re-runs normalization on each parent thread, inserts rows. Safe to re-run.

### WOT_Slack_Bot — internal HTTP endpoint

- Route: `GET /internal/sales/:slack_user_id?range=day|week|month`
- Auth: header `X-Internal-Api-Key: <INTERNAL_API_KEY>`. Reject with 401 otherwise. Log rejected requests.
- Response:
  ```json
  {
    "counters": { "wins": 5, "losses": 2, "winRate": 0.714, "totalAmount": 12840.00, "currency": "EUR" },
    "recent": [
      { "client": "X", "destination": "Y", "outcome": "won", "amount": 1200, "currency": "EUR", "resolvedAt": "2026-04-15T09:11:00Z", "permalink": "..." }
    ]
  }
  ```
- Ranges computed in UTC; client re-buckets in the agent's local TZ if needed.
- Bound to Railway private networking where available; otherwise fail-closed via API key + basic rate limit (e.g. 60 req/min/key).

### admin-web — proxy endpoint

- Route: `GET /api/sales/me` — authenticated via the device's existing pairing key (same mechanism as heartbeat).
- Looks up the calling device's `slack_user_id` from `devices`. If null → `{ "unconfigured": true }`.
- Otherwise proxies to Slack bot with `X-Internal-Api-Key`. Returns bot response passthrough.
- On bot error / timeout (5s) → `{ "unavailable": true }`.
- In-memory cache: 60s TTL keyed by `(slack_user_id, range)`.
- Security invariant: a device can **only** fetch its own device's sales. Arbitrary `slack_user_id` not accepted from client.

### ProduTime client — data service

- New `src/renderer/services/slack-sales-service.ts`.
- Polls `/api/sales/me?range=<selected>` every 5 minutes and on dashboard focus (visibilitychange).
- Caches last successful response for offline-safe rendering.
- Feeds `SalesStatsPanel`.

---

## Section 4 — Edge Cases, Errors, Testing

### Lock edge cases

| Scenario | Behavior |
|---|---|
| Fresh install, admin policy pre-assigns name | Client stores name + sets `employee_name_locked=true` immediately. User never sees editable state. |
| Admin clears name (empty) | Client clears lock so user can re-enter. |
| Existing install post-upgrade with name already set | Migration sets `employee_name_locked=true` once. |
| Admin edits name via Devices tab | Client overwrites local value on `POLICY_PUSH` regardless of lock. |

### Sales pipeline failures

| Failure | Handling |
|---|---|
| Slack bot unreachable | admin-web returns `{ unavailable: true }` after 5s timeout → panel shows retry UI. |
| `slack_user_id` unset for device | `{ unconfigured: true }` → panel shows "Ask your admin to link your Slack account." |
| Backfill re-run | Idempotent via `INSERT OR IGNORE` on `thread_key`. |
| Clock skew / TZ | Server returns UTC ISO timestamps; client buckets in local TZ for day/week/month. |

### Security

- `INTERNAL_API_KEY` in Railway env on both services; never reaches clients.
- Bot endpoint key-gated; rejected requests logged.
- admin-web never accepts a user-supplied `slack_user_id` — it's resolved server-side from device identity.
- Rate limit on bot endpoint: 60 req/min per key.

### Testing

**Unit / integration:**
- Normalizer insert path (with and without an existing row).
- admin-web proxy: auth, cache hit/miss, unconfigured, unavailable.
- Client lock state machine: first save, admin overwrite, admin clear.

**Manual smoke:**
- Fresh install → enter name → locked.
- Admin Devices → Edit → change name + add `slack_user_id` → client reflects both.
- Sales panel populates; toggle Today/Week/Month.
- Stop Slack bot → panel shows unavailable with retry.
- Unset `slack_user_id` → unconfigured state.

---

## File Touch List (non-exhaustive)

**ProduTime:**
- `src/main/database.ts` — migration for `employee_name_locked`, `slack_user_id` settings-table defaults.
- `src/main/ipc-handlers.ts` — expose new settings read/write.
- `src/main/services/agent/agent-service.ts` — `applyPolicy()` handles `slackUserId`; `getDeviceDisplayName()` unchanged.
- `src/shared/admin-protocol.ts` — add `slackUserId` to `PolicyData`.
- `src/renderer/components/SettingsTab.tsx`, `PolicyView.tsx` — lock behavior + Slack User ID row.
- `src/renderer/components/ActivityDashboard.tsx` — layout reshuffle.
- `src/renderer/components/SalesStatsPanel.tsx` — new.
- `src/renderer/services/slack-sales-service.ts` — new.

**admin-console:**
- `admin-console/src/renderer/components/DeviceList.tsx` — Edit button + modal.
- admin-console IPC / WebSocket message adding `UPDATE_DEVICE_IDENTITY` (or reusing policy push) with `displayName`, `slackUserId`.

**admin-web (Railway):**
- `admin-web/src/server/db.ts` — migration adding `display_name`, `slack_user_id` to `devices`.
- `admin-web/src/server/routes/sales.ts` — new `/api/sales/me`.
- `admin-web/src/server/routes/devices.ts` (or equivalent) — accept edits.

**WOT_Slack_Bot:**
- `src/wotaibot/services/sales_case_normalizer.py` — DB insert alongside channel post.
- `src/wotaibot/db/sales_cases.py` — new SQLite wrapper.
- `src/wotaibot/http/internal_sales.py` — new Flask/FastAPI route.
- `scripts/backfill_sales_cases.py` — new.
