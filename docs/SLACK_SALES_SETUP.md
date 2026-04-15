# Slack Sales Integration — Setup Guide

This walks through enabling the Slack sales panel on the ProduTime
dashboard for a given agent.

## 1. Railway env vars

Both services must share the same `INTERNAL_API_KEY`.

**WOT_Slack_Bot (Railway service):**

| Name | Example | Purpose |
|---|---|---|
| `INTERNAL_API_KEY` | `<random 32+ byte hex>` | Required on every request to `/internal/sales/*`. |
| `SALES_DB_PATH` | `/app/data/sales.db` | Persistent path for the sales_cases DB. Mount a Railway volume at `/app/data`. |
| `SALES_AGGREGATE_CHANNEL` | `C0ATRV7RRL0` | Optional override of the default aggregate channel id used by the backfill. |

**ProduTime admin-web (Railway service):**

| Name | Example | Purpose |
|---|---|---|
| `INTERNAL_API_KEY` | same value as above | Sent as `X-Internal-Api-Key` on proxied requests. |
| `SLACK_BOT_INTERNAL_URL` | `http://<railway-private>:8000` | Private URL to the Slack bot's Flask app. |

Devices never see these values — the proxy happens entirely on the server.

## 2. Backfill historical sales (one-time)

From the Slack bot's shell, once the env vars above are in place:

```bash
PYTHONPATH=src SLACK_BOT_TOKEN=xoxb-... \
  python scripts/backfill_sales_store_from_aggregate.py
```

This reads `#sales-aggregate` and fills `sales_cases`. Posts that were
created before we started attaching structured metadata will be skipped
(they have no `event_payload`). Re-running the script is safe
(`INSERT OR IGNORE`).

## 3. Link an agent

In the admin panel's Devices tab, click **Edit** on the device row. Set
the Slack user id (e.g. `U01ABCDEF`). On Save:

- `devices.slack_user_id` is updated.
- A `POLICY_PUSH` is sent over the device's WebSocket so the client
  mirrors the change immediately. Offline devices receive it on
  reconnect.

## 4. Verify on the client

Dashboard → right column should render:

- **Ask your admin to link your Slack account** if `slack_user_id` is
  empty for the device.
- **Sales data unavailable** with a Retry button if the bot is
  unreachable or the key is wrong.
- Counters + recent tickets otherwise. Toggle Today / Week / Month.

## Security notes

- Bot endpoint is key-gated. Requests without the header are rejected
  401 and logged.
- admin-web never trusts a client-supplied `slack_user_id` — it's
  resolved server-side from the pairing identity.
- Responses are cached 60s in admin-web, keyed by `<uid>:<range>`.
- Sales data is scoped by Slack user id; agents only see their own.
