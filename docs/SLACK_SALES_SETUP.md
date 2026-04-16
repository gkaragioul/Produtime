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
| `SLACK_BOT_INTERNAL_URL` | `https://wot-slack-bot-production.up.railway.app` | Public URL of the Slack bot service. The endpoint is key-gated. |

> **Why the public URL, not `*.railway.internal`?** Railway's private DNS only
> resolves between services in the **same** project. WOT-Produtime and
> WOT-Slack-Bot live in separate projects, so the private hostname returns
> `ENOTFOUND`. Hitting the public URL goes through Railway's edge but still
> lands on the same Flask handler, key-gated by `X-Internal-Api-Key`.

Devices never see these values — the proxy happens entirely on the server.

## 2. Backfill historical sales (one-time)

From the Slack bot's shell, once the env vars above are in place:

```bash
PYTHONPATH=src SLACK_BOT_TOKEN=xoxb-... \
  python scripts/backfill_sales_store_from_aggregate.py
```

This reads `#sales-aggregate` and fills `sales_cases`. Two paths:

1. New posts (after this feature shipped) carry structured `event_payload`
   metadata — we use it directly.
2. Older posts get re-parsed from the rendered template (Case / Agent /
   Outcome / Amount / Destination / Travel dates / Travelers / Contact /
   Budget / What they wanted / Objections / Notes). The agent's Slack
   user_id is recovered with a `conversations.replies` lookup on the
   permalinked thread.

Re-running is safe (`INSERT OR IGNORE` on `channel:thread_ts`).

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
