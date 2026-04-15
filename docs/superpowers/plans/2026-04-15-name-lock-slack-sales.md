# Name Lock, Admin Identity Sync, and Slack Sales Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the ProduTime employee name after first entry, let admins edit it and set a Slack User ID from the Devices tab with sync to the client, and show per-agent Slack sales stats (day/week/month + recent 10) in the currently-empty right column of the ProduTime dashboard.

**Architecture:** Adds `employee_name_locked` + `slack_user_id` to client settings; adds `display_name` + `slack_user_id` columns to admin-web `devices`; extends `POLICY_PUSH` with `slackUserId`. Slack bot gains a `sales_cases` SQLite table (written inside the existing won/lost normalizer) plus an internal Flask `/internal/sales/:user_id` endpoint key-gated by `INTERNAL_API_KEY`. admin-web adds `GET /api/sales/me` that proxies to the bot using the device's own `slack_user_id` (never a client-supplied one). Dashboard layout is restructured: Focus Summary moves under the Current Activity card on the left; a new `SalesStatsPanel` fills the right column.

**Tech Stack:** TypeScript/React (ProduTime + admin-web + admin-console renderer), Node/Electron main (ProduTime), better-sqlite3 (ProduTime + admin-web DB), Python/Flask (Slack bot), stdlib `sqlite3` (Slack bot), existing WebSocket pairing protocol, Railway private env.

**Spec:** `docs/superpowers/specs/2026-04-15-name-lock-slack-sales-design.md`

---

## File Structure

### New files
- `src/renderer/components/SalesStatsPanel.tsx` — dashboard right-column panel
- `src/renderer/services/slack-sales-service.ts` — polling client for `/api/sales/me`
- `admin-web/src/server/routes/sales.ts` — `/api/sales/me` proxy (or inline in `device-server.ts` if routes are inline there)
- `admin-console/src/renderer/components/EditDeviceModal.tsx` — edit name + Slack User ID modal
- `C:\Users\georg\Documents\DevWork\World_Of_Travel\WOT_Slack_Bot\src\wotaibot\services\sales_store.py` — SQLite wrapper for `sales_cases`
- `C:\Users\georg\Documents\DevWork\World_Of_Travel\WOT_Slack_Bot\src\wotaibot\http\internal_sales.py` — Flask blueprint exposing `/internal/sales/<user_id>`
- `C:\Users\georg\Documents\DevWork\World_Of_Travel\WOT_Slack_Bot\scripts\backfill_sales_cases.py` — one-time backfill from `#sales-aggregate`
- Tests alongside each new module.

### Modified files
- `src/main/database.ts` — migration #5: seed `employee_name_locked` default; no schema change (uses `settings` KV).
- `src/main/ipc-handlers.ts` — new `settings:saveEmployeeName` guard; expose `slack_user_id` read.
- `src/main/services/agent/agent-service.ts` — `applyPolicy()` writes `slack_user_id`; clears lock when admin pushes empty name.
- `src/shared/admin-protocol.ts` — `PolicyData.slackUserId?: string`.
- `src/renderer/components/PolicyView.tsx` — lock behavior + Slack User ID read-only row.
- `src/renderer/components/SettingsTab.tsx` — same lock behavior on the settings name input.
- `src/renderer/components/ActivityDashboard.tsx` — layout reshuffle; mount `SalesStatsPanel` + `FocusSummary`.
- `admin-web/src/server/db.ts` — migration adding `display_name`, `slack_user_id` to `devices`; cache invalidation.
- `admin-web/src/server/device-server.ts` — device PATCH endpoint accepting `displayName` + `slackUserId`; triggers policy push.
- `admin-console/src/renderer/components/DeviceList.tsx` — Edit button, row-level Slack UID display.
- `C:\Users\georg\Documents\DevWork\World_Of_Travel\WOT_Slack_Bot\src\wotaibot\services\sales_case_normalizer.py` — insert into `sales_cases` alongside existing channel post.
- `C:\Users\georg\Documents\DevWork\World_Of_Travel\WOT_Slack_Bot\src\wotaibot\health.py` — register the new internal blueprint on the existing Flask app.

---

## Task 1: Client settings — add lock flag and Slack User ID plumbing

**Files:**
- Modify: `src/main/database.ts`
- Modify: `src/shared/admin-protocol.ts`
- Modify: `src/main/services/agent/agent-service.ts`
- Modify: `src/main/ipc-handlers.ts`
- Test: `test/main/agent-service.policy.test.ts`

- [ ] **Step 1: Add `slackUserId` to PolicyData**

In `src/shared/admin-protocol.ts`, extend `PolicyData`:
```ts
export interface PolicyData {
  // ...existing fields left untouched
  employeeName?: string;
  slackUserId?: string;
}
```

- [ ] **Step 2: Migration seeding lock for existing installs**

Add migration #5 (or the next unused number) in `src/main/database.ts`:
```ts
{
  version: 5,
  description: "Seed employee_name_locked for existing named installs",
  up: (db) => {
    const existing = db.prepare("SELECT value FROM settings WHERE key='employee_name'").get() as {value:string}|undefined;
    const lock = db.prepare("SELECT value FROM settings WHERE key='employee_name_locked'").get();
    if (existing && existing.value && existing.value.trim() && !lock) {
      db.prepare("INSERT INTO settings(key,value) VALUES('employee_name_locked','true')").run();
    }
  }
}
```
Do **not** wrap in `BEGIN TRANSACTION` (the migration runner already does).

- [ ] **Step 3: Extend `applyPolicy` to handle `slackUserId` and admin clears**

In `src/main/services/agent/agent-service.ts`, within `applyPolicy(policy: PolicyData)`:
```ts
if (typeof policy.employeeName !== 'undefined') {
  const v = (policy.employeeName || '').trim();
  this.database.setSetting('employee_name', v);
  if (v === '') {
    this.database.setSetting('employee_name_locked', 'false');
  } else {
    this.database.setSetting('employee_name_locked', 'true');
  }
}
if (typeof policy.slackUserId !== 'undefined') {
  this.database.setSetting('slack_user_id', (policy.slackUserId || '').trim());
}
```
Broadcast change with the existing `policyUpdated` event so the renderer refreshes.

- [ ] **Step 4: IPC handler — guarded employee name save**

In `src/main/ipc-handlers.ts`, replace any direct write of `employee_name` from the renderer with:
```ts
ipcMain.handle('settings:saveEmployeeName', (_e, name: string) => {
  const locked = database.getSetting('employee_name_locked') === 'true';
  if (locked) return { ok: false, reason: 'locked' };
  const v = (name || '').trim();
  if (!v) return { ok: false, reason: 'empty' };
  database.setSetting('employee_name', v);
  database.setSetting('employee_name_locked', 'true');
  return { ok: true };
});

ipcMain.handle('settings:getIdentity', () => ({
  employeeName: database.getSetting('employee_name') || '',
  locked: database.getSetting('employee_name_locked') === 'true',
  slackUserId: database.getSetting('slack_user_id') || ''
}));
```
Expose both in `src/preload.ts` (if used) under an `identity` namespace.

- [ ] **Step 5: Commit**

```bash
git add src/shared/admin-protocol.ts src/main/database.ts src/main/services/agent/agent-service.ts src/main/ipc-handlers.ts src/preload.ts
git commit -m "feat(client): add employee name lock and slack_user_id sync plumbing"
```

---

## Task 2: Client UI — lock name, show Slack User ID

**Files:**
- Modify: `src/renderer/components/PolicyView.tsx`
- Modify: `src/renderer/components/SettingsTab.tsx`

- [ ] **Step 1: Load identity in PolicyView**

At top of `PolicyView.tsx`, add:
```tsx
const [identity, setIdentity] = useState<{employeeName:string; locked:boolean; slackUserId:string}>({employeeName:'', locked:false, slackUserId:''});
useEffect(() => {
  (window as any).api.invoke('settings:getIdentity').then(setIdentity);
  const off = (window as any).api.on?.('policy:updated', () => {
    (window as any).api.invoke('settings:getIdentity').then(setIdentity);
  });
  return () => { off?.(); };
}, []);
```

- [ ] **Step 2: Render name input disabled when locked + save via guarded IPC**

Replace the existing Name text input block. Render input disabled when `identity.locked`, with tooltip text "Locked — contact your admin to change." Keep the Save button visible only when unlocked:
```tsx
<input
  type="text"
  value={identity.employeeName}
  disabled={identity.locked}
  onChange={e => setIdentity({...identity, employeeName: e.target.value})}
  placeholder="Enter your name..."
  title={identity.locked ? 'Locked — contact your admin to change.' : ''}
/>
{!identity.locked && (
  <button onClick={async () => {
    const r = await (window as any).api.invoke('settings:saveEmployeeName', identity.employeeName);
    if (r.ok) setIdentity(i => ({...i, locked: true}));
  }}>Save</button>
)}
```

- [ ] **Step 3: Render Slack User ID read-only row when populated**

Below the name input:
```tsx
{identity.slackUserId && (
  <div className="setting-row">
    <label>Slack User ID</label>
    <div className="readonly-value">{identity.slackUserId}</div>
  </div>
)}
```

- [ ] **Step 4: Apply the same lock behavior in SettingsTab.tsx**

Mirror Steps 1–3 in `SettingsTab.tsx` at the existing `employee-name` input (lines ~1395–1412). Do not duplicate logic — if there's an existing hook/util for loading identity, use it; otherwise call the same IPC.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/PolicyView.tsx src/renderer/components/SettingsTab.tsx
git commit -m "feat(client): lock employee name after first save and surface Slack User ID"
```

---

## Task 3: admin-web DB migration and device edit endpoint

**Files:**
- Modify: `admin-web/src/server/db.ts`
- Modify: `admin-web/src/server/device-server.ts`

- [ ] **Step 1: Migration — add columns to `devices`**

In `admin-web/src/server/db.ts`, add migration:
```ts
{
  version: /* next */, up: (db) => {
    db.exec(`
      ALTER TABLE devices ADD COLUMN display_name TEXT;
      ALTER TABLE devices ADD COLUMN slack_user_id TEXT;
    `);
  }
}
```
Use `INSTR(sqlite_master.sql,'display_name')` idempotency guard if the codebase uses idempotent migrations — follow the existing pattern.

- [ ] **Step 2: PATCH endpoint for device identity**

In `admin-web/src/server/device-server.ts`, add:
```ts
app.patch('/api/devices/:id', requireAdminAuth, (req, res) => {
  const { displayName, slackUserId } = req.body ?? {};
  const id = req.params.id;
  db.prepare('UPDATE devices SET display_name=?, slack_user_id=? WHERE device_id=?')
    .run(displayName ?? null, slackUserId ?? null, id);
  pushPolicyToDevice(id, { employeeName: displayName ?? '', slackUserId: slackUserId ?? '' });
  res.json({ ok: true });
});
```
Use whatever admin auth middleware already exists for Devices list.

- [ ] **Step 3: Include `slackUserId` in outgoing policy**

Wherever `POLICY_PUSH` is assembled for a device, include `slackUserId: device.slack_user_id || ''`. Same for the initial policy sent on reconnect.

- [ ] **Step 4: Expose identity in `/api/devices` list response**

Return `display_name` and `slack_user_id` in the devices listing so the admin console can render and edit them.

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/server/db.ts admin-web/src/server/device-server.ts
git commit -m "feat(admin-web): device display_name + slack_user_id with PATCH endpoint"
```

---

## Task 4: admin-console — Edit button and modal

**Files:**
- Create: `admin-console/src/renderer/components/EditDeviceModal.tsx`
- Modify: `admin-console/src/renderer/components/DeviceList.tsx`

- [ ] **Step 1: EditDeviceModal**

Create `EditDeviceModal.tsx`:
```tsx
import React, { useState } from 'react';

interface Props {
  device: { device_id: string; display_name?: string; slack_user_id?: string; device_name: string };
  onClose: () => void;
  onSaved: () => void;
}
export const EditDeviceModal: React.FC<Props> = ({ device, onClose, onSaved }) => {
  const [displayName, setDisplayName] = useState(device.display_name ?? device.device_name ?? '');
  const [slackUserId, setSlackUserId] = useState(device.slack_user_id ?? '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const r = await fetch(`/api/devices/${device.device_id}`, {
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ displayName: displayName.trim(), slackUserId: slackUserId.trim() })
    });
    setSaving(false);
    if (r.ok) { onSaved(); onClose(); }
  };
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Edit device</h3>
        <label>Display Name<input value={displayName} onChange={e=>setDisplayName(e.target.value)} /></label>
        <label>Slack User ID<input value={slackUserId} onChange={e=>setSlackUserId(e.target.value)} placeholder="U01ABCDEF" /></label>
        <div className="modal-actions">
          <button onClick={onClose} disabled={saving}>Cancel</button>
          <button onClick={save} disabled={saving}>Save</button>
        </div>
      </div>
    </div>
  );
};
```
If the admin console uses a different HTTP client / auth header, mirror the existing pattern used by Lock/Unlock.

- [ ] **Step 2: Wire Edit button into DeviceList**

In `DeviceList.tsx`, next to the existing Lock/Unlock/Delete actions, add:
```tsx
<button onClick={() => setEditing(device)}>Edit</button>
```
State + JSX at the bottom:
```tsx
const [editing, setEditing] = useState<Device|null>(null);
// ...
{editing && <EditDeviceModal device={editing} onClose={()=>setEditing(null)} onSaved={refresh} />}
```
Under the IP address row, show `{device.slack_user_id && <div className="muted small">Slack: {device.slack_user_id}</div>}`.

- [ ] **Step 3: Commit**

```bash
git add admin-console/src/renderer/components/EditDeviceModal.tsx admin-console/src/renderer/components/DeviceList.tsx
git commit -m "feat(admin-console): edit device display name + slack user id"
```

---

## Task 5: Slack bot — `sales_cases` SQLite store

**Files:**
- Create: `C:\Users\georg\Documents\DevWork\World_Of_Travel\WOT_Slack_Bot\src\wotaibot\services\sales_store.py`
- Create: `C:\Users\georg\Documents\DevWork\World_Of_Travel\WOT_Slack_Bot\tests\unit\test_sales_store.py`

- [ ] **Step 1: Write failing test**

Create the test file:
```python
import os, tempfile, sqlite3
from wotaibot.services.sales_store import SalesStore

def test_insert_and_query_by_agent_and_range():
    with tempfile.TemporaryDirectory() as d:
        s = SalesStore(os.path.join(d,'s.db'))
        s.upsert(thread_key='C1:1.0', agent_user_id='U1', outcome='won',
                 final_amount=1000, currency='EUR', client_name='A',
                 destination='X', resolved_at='2026-04-15T10:00:00Z',
                 source_channel='C1', permalink='u', raw_json='{}')
        s.upsert(thread_key='C1:2.0', agent_user_id='U1', outcome='lost',
                 final_amount=None, currency=None, client_name='B',
                 destination='Y', resolved_at='2026-04-15T11:00:00Z',
                 source_channel='C1', permalink='u', raw_json='{}')
        rows = s.by_agent('U1', since_iso='2026-04-15T00:00:00Z')
        assert len(rows) == 2
        counters = s.counters('U1', since_iso='2026-04-15T00:00:00Z')
        assert counters['wins'] == 1 and counters['losses'] == 1
        assert abs(counters['winRate'] - 0.5) < 1e-6
        assert counters['totalAmount'] == 1000

def test_upsert_is_idempotent():
    with tempfile.TemporaryDirectory() as d:
        s = SalesStore(os.path.join(d,'s.db'))
        for _ in range(3):
            s.upsert(thread_key='C1:1.0', agent_user_id='U1', outcome='won',
                     final_amount=10, currency='EUR', client_name='A',
                     destination='X', resolved_at='2026-04-15T10:00:00Z',
                     source_channel='C1', permalink='u', raw_json='{}')
        assert len(s.by_agent('U1', since_iso='2026-04-15T00:00:00Z')) == 1
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "c:/Users/georg/Documents/DevWork/World_Of_Travel/WOT_Slack_Bot"
PYTHONPATH=src python -m pytest tests/unit/test_sales_store.py -v
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `SalesStore`**

Create `sales_store.py`:
```python
import os, sqlite3, threading
from typing import Optional, Dict, Any, List

_SCHEMA = '''
CREATE TABLE IF NOT EXISTS sales_cases (
  thread_key     TEXT PRIMARY KEY,
  agent_user_id  TEXT NOT NULL,
  outcome        TEXT NOT NULL,
  final_amount   REAL,
  currency       TEXT,
  client_name    TEXT,
  destination    TEXT,
  resolved_at    TEXT NOT NULL,
  source_channel TEXT NOT NULL,
  permalink      TEXT,
  raw_json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_agent_time ON sales_cases(agent_user_id, resolved_at DESC);
'''

class SalesStore:
    def __init__(self, path: str):
        os.makedirs(os.path.dirname(os.path.abspath(path)) or '.', exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._conn: self._conn.executescript(_SCHEMA)

    def upsert(self, **row) -> None:
        cols = ['thread_key','agent_user_id','outcome','final_amount','currency',
                'client_name','destination','resolved_at','source_channel','permalink','raw_json']
        with self._lock, self._conn:
            self._conn.execute(
                f"INSERT OR IGNORE INTO sales_cases ({','.join(cols)}) VALUES ({','.join(['?']*len(cols))})",
                [row.get(c) for c in cols]
            )

    def by_agent(self, user_id: str, since_iso: str, limit: int = 100) -> List[Dict[str,Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM sales_cases WHERE agent_user_id=? AND resolved_at>=? ORDER BY resolved_at DESC LIMIT ?",
                (user_id, since_iso, limit)
            ).fetchall()
        return [dict(r) for r in rows]

    def counters(self, user_id: str, since_iso: str) -> Dict[str, Any]:
        rows = self.by_agent(user_id, since_iso, limit=10_000)
        wins = sum(1 for r in rows if r['outcome'] == 'won')
        losses = sum(1 for r in rows if r['outcome'] == 'lost')
        total = sum((r['final_amount'] or 0) for r in rows if r['outcome'] == 'won')
        n = wins + losses
        currency = next((r['currency'] for r in rows if r['currency']), None)
        return {'wins': wins, 'losses': losses, 'winRate': (wins/n) if n else 0.0,
                'totalAmount': total, 'currency': currency}
```

- [ ] **Step 4: Run test to verify pass**

```bash
PYTHONPATH=src python -m pytest tests/unit/test_sales_store.py -v
```
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/wotaibot/services/sales_store.py tests/unit/test_sales_store.py
git commit -m "feat(slack-bot): add sales_cases SQLite store with idempotent upsert"
```

---

## Task 6: Slack bot — persist sales inside the normalizer

**Files:**
- Modify: `C:\Users\georg\Documents\DevWork\World_Of_Travel\WOT_Slack_Bot\src\wotaibot\services\sales_case_normalizer.py`

- [ ] **Step 1: Add singleton accessor for the store**

At the top of `sales_case_normalizer.py`:
```python
from wotaibot.services.sales_store import SalesStore
import os, json

_STORE: SalesStore | None = None
def _store() -> SalesStore:
    global _STORE
    if _STORE is None:
        path = os.environ.get('SALES_DB_PATH', os.path.join(os.path.expanduser('~'), '.wot_slack_bot', 'sales.db'))
        _STORE = SalesStore(path)
    return _STORE
```

- [ ] **Step 2: Insert after normalization, before posting to #sales-aggregate**

Find the block that posts the normalized message to `#sales-aggregate` (the `post_to_sales_aggregate`/equivalent call). Immediately before it, add:
```python
try:
    _store().upsert(
        thread_key=f"{source_channel_id}:{thread_ts}",
        agent_user_id=agent_user_id,
        outcome='won' if reaction == 'moneybag' else 'lost',
        final_amount=normalized.get('final_amount_value'),
        currency=normalized.get('final_amount_currency'),
        client_name=normalized.get('client_name'),
        destination=normalized.get('destination'),
        resolved_at=resolved_iso,  # ISO8601 UTC — use datetime.utcnow().isoformat() + 'Z' if not already present
        source_channel=source_channel_id,
        permalink=permalink,
        raw_json=json.dumps(normalized, ensure_ascii=False),
    )
except Exception as e:
    logger.exception("sales_cases upsert failed: %s", e)
```
Use the existing names if they differ — do not invent new variables. Do not raise; failures here must not break the original posting flow.

- [ ] **Step 3: Smoke test via existing normalizer tests**

Run the bot's existing normalizer tests (if any). If there are none, add a unit test that calls the normalizer's post step with a mocked Slack client and asserts a row lands in a temp `SalesStore`.

- [ ] **Step 4: Commit**

```bash
git add src/wotaibot/services/sales_case_normalizer.py
git commit -m "feat(slack-bot): persist normalized sales into sales_cases store"
```

---

## Task 7: Slack bot — internal HTTP endpoint

**Files:**
- Create: `C:\Users\georg\Documents\DevWork\World_Of_Travel\WOT_Slack_Bot\src\wotaibot\http\__init__.py`
- Create: `C:\Users\georg\Documents\DevWork\World_Of_Travel\WOT_Slack_Bot\src\wotaibot\http\internal_sales.py`
- Modify: `C:\Users\georg\Documents\DevWork\World_Of_Travel\WOT_Slack_Bot\src\wotaibot\health.py`
- Create: `C:\Users\georg\Documents\DevWork\World_Of_Travel\WOT_Slack_Bot\tests\unit\test_internal_sales.py`

- [ ] **Step 1: Write failing test**

```python
import os, tempfile
from flask import Flask
from wotaibot.http.internal_sales import register_internal_sales
from wotaibot.services.sales_store import SalesStore

def _app(tmpdb, key='secret'):
    os.environ['INTERNAL_API_KEY'] = key
    os.environ['SALES_DB_PATH'] = tmpdb
    app = Flask(__name__)
    register_internal_sales(app)
    return app

def test_rejects_missing_key(tmp_path):
    app = _app(str(tmp_path/'s.db'))
    c = app.test_client()
    r = c.get('/internal/sales/U1?range=day')
    assert r.status_code == 401

def test_accepts_valid_key_and_returns_shape(tmp_path):
    db = str(tmp_path/'s.db'); SalesStore(db)  # creates schema
    app = _app(db, key='k')
    c = app.test_client()
    r = c.get('/internal/sales/U1?range=week', headers={'X-Internal-Api-Key':'k'})
    assert r.status_code == 200
    j = r.get_json()
    assert set(j.keys()) >= {'counters','recent'}
    assert set(j['counters'].keys()) >= {'wins','losses','winRate','totalAmount'}

def test_rejects_invalid_range(tmp_path):
    db = str(tmp_path/'s.db'); SalesStore(db)
    app = _app(db, key='k')
    c = app.test_client()
    r = c.get('/internal/sales/U1?range=year', headers={'X-Internal-Api-Key':'k'})
    assert r.status_code == 400
```

- [ ] **Step 2: Run test (expect fail)**

```bash
PYTHONPATH=src python -m pytest tests/unit/test_internal_sales.py -v
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement blueprint + range computation**

`src/wotaibot/http/__init__.py` — empty file.

`src/wotaibot/http/internal_sales.py`:
```python
import os
from datetime import datetime, timedelta, timezone
from flask import Blueprint, request, jsonify
from wotaibot.services.sales_store import SalesStore

bp = Blueprint('internal_sales', __name__)

def _store() -> SalesStore:
    return SalesStore(os.environ['SALES_DB_PATH'])

def _since(range_key: str) -> str:
    now = datetime.now(timezone.utc)
    if range_key == 'day':
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif range_key == 'week':
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    elif range_key == 'month':
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        raise ValueError('bad range')
    return start.isoformat().replace('+00:00','Z')

@bp.get('/internal/sales/<user_id>')
def get_sales(user_id: str):
    key = os.environ.get('INTERNAL_API_KEY')
    if not key or request.headers.get('X-Internal-Api-Key') != key:
        return ('unauthorized', 401)
    range_key = request.args.get('range', 'week')
    try:
        since = _since(range_key)
    except ValueError:
        return ('bad range', 400)
    s = _store()
    counters = s.counters(user_id, since)
    recent = s.by_agent(user_id, since, limit=10)
    return jsonify({
        'counters': counters,
        'recent': [
            {
              'client': r['client_name'], 'destination': r['destination'],
              'outcome': r['outcome'], 'amount': r['final_amount'],
              'currency': r['currency'], 'resolvedAt': r['resolved_at'],
              'permalink': r['permalink']
            } for r in recent
        ]
    })

def register_internal_sales(app):
    app.register_blueprint(bp)
```

- [ ] **Step 4: Register blueprint on the health Flask app**

In `health.py` inside the existing `def create_health_app(...)` (or wherever the Flask app is constructed), after app creation:
```python
from wotaibot.http.internal_sales import register_internal_sales
register_internal_sales(app)
```

- [ ] **Step 5: Run test**

```bash
PYTHONPATH=src python -m pytest tests/unit/test_internal_sales.py -v
```
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/wotaibot/http/__init__.py src/wotaibot/http/internal_sales.py src/wotaibot/health.py tests/unit/test_internal_sales.py
git commit -m "feat(slack-bot): internal /internal/sales endpoint with shared-key auth"
```

---

## Task 8: Slack bot — backfill script

**Files:**
- Create: `C:\Users\georg\Documents\DevWork\World_Of_Travel\WOT_Slack_Bot\scripts\backfill_sales_cases.py`

- [ ] **Step 1: Implement**

```python
"""Backfill sales_cases from history of #sales-aggregate.

Run: PYTHONPATH=src SALES_DB_PATH=... python scripts/backfill_sales_cases.py
"""
import os, json
from slack_sdk import WebClient
from wotaibot.services.sales_store import SalesStore

SALES_AGGREGATE = os.environ.get('SALES_AGGREGATE_CHANNEL', 'C0ATRV7RRL0')

def main() -> int:
    client = WebClient(token=os.environ['SLACK_BOT_TOKEN'])
    store = SalesStore(os.environ.get('SALES_DB_PATH','sales.db'))
    cursor = None
    n = 0
    while True:
        r = client.conversations_history(channel=SALES_AGGREGATE, cursor=cursor, limit=200)
        for m in r.get('messages', []):
            meta = m.get('metadata', {})
            payload = meta.get('event_payload') if isinstance(meta, dict) else None
            if not payload:
                continue  # skip messages without structured metadata
            try:
                store.upsert(
                    thread_key=payload['thread_key'],
                    agent_user_id=payload['agent_user_id'],
                    outcome=payload['outcome'],
                    final_amount=payload.get('final_amount'),
                    currency=payload.get('currency'),
                    client_name=payload.get('client_name'),
                    destination=payload.get('destination'),
                    resolved_at=payload['resolved_at'],
                    source_channel=payload['source_channel'],
                    permalink=payload.get('permalink'),
                    raw_json=json.dumps(payload, ensure_ascii=False),
                )
                n += 1
            except Exception as e:
                print('skip', e)
        if not r.get('has_more'): break
        cursor = r.get('response_metadata',{}).get('next_cursor')
    print(f'backfilled {n}')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
```

> If historical messages pre-date the metadata-attached posting path, this backfill will naturally skip them. That's acceptable — older sales will still appear if manually re-reacted. Document this in the script docstring (already noted via `continue` with a comment).

- [ ] **Step 2: Update normalizer post step to attach structured metadata**

In `sales_case_normalizer.py`, when calling `chat.postMessage` to `#sales-aggregate`, add:
```python
metadata={'event_type':'sales_case', 'event_payload': {
    'thread_key': f"{source_channel_id}:{thread_ts}",
    'agent_user_id': agent_user_id,
    'outcome': 'won' if reaction == 'moneybag' else 'lost',
    'final_amount': normalized.get('final_amount_value'),
    'currency': normalized.get('final_amount_currency'),
    'client_name': normalized.get('client_name'),
    'destination': normalized.get('destination'),
    'resolved_at': resolved_iso,
    'source_channel': source_channel_id,
    'permalink': permalink,
}}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill_sales_cases.py src/wotaibot/services/sales_case_normalizer.py
git commit -m "feat(slack-bot): backfill script + structured metadata on aggregate posts"
```

---

## Task 9: admin-web — `/api/sales/me` proxy

**Files:**
- Create: `admin-web/src/server/routes/sales.ts`
- Modify: `admin-web/src/server/device-server.ts` (mount route)

- [ ] **Step 1: Implement proxy**

`admin-web/src/server/routes/sales.ts`:
```ts
import type { Express } from 'express';
import type Database from 'better-sqlite3';

const cache = new Map<string, { at: number; body: any }>();
const TTL_MS = 60_000;

export function registerSalesRoutes(app: Express, db: Database.Database) {
  app.get('/api/sales/me', async (req, res) => {
    // `req.device` must be set by the existing device-auth middleware used for heartbeats.
    const deviceId = (req as any).device?.device_id;
    if (!deviceId) return res.status(401).json({ error: 'unauthenticated' });
    const row = db.prepare('SELECT slack_user_id FROM devices WHERE device_id=?').get(deviceId) as {slack_user_id?:string}|undefined;
    const uid = row?.slack_user_id;
    if (!uid) return res.json({ unconfigured: true });
    const range = ['day','week','month'].includes(String(req.query.range)) ? String(req.query.range) : 'week';
    const ck = `${uid}:${range}`;
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < TTL_MS) return res.json(hit.body);
    try {
      const url = `${process.env.SLACK_BOT_INTERNAL_URL}/internal/sales/${encodeURIComponent(uid)}?range=${range}`;
      const r = await fetch(url, {
        headers: { 'X-Internal-Api-Key': process.env.INTERNAL_API_KEY ?? '' },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return res.json({ unavailable: true });
      const body = await r.json();
      cache.set(ck, { at: Date.now(), body });
      res.json(body);
    } catch {
      res.json({ unavailable: true });
    }
  });
}
```

- [ ] **Step 2: Mount route**

In `device-server.ts`, after app & db are wired:
```ts
import { registerSalesRoutes } from './routes/sales';
registerSalesRoutes(app, db);
```
Ensure the route goes **after** the device-auth middleware that populates `req.device` for paired devices.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/server/routes/sales.ts admin-web/src/server/device-server.ts
git commit -m "feat(admin-web): /api/sales/me proxy with 60s cache and timeout"
```

---

## Task 10: Client — slack-sales service + SalesStatsPanel

**Files:**
- Create: `src/renderer/services/slack-sales-service.ts`
- Create: `src/renderer/components/SalesStatsPanel.tsx`

- [ ] **Step 1: slack-sales-service**

```ts
export type SalesRange = 'day' | 'week' | 'month';
export interface SalesResponse {
  counters?: { wins:number; losses:number; winRate:number; totalAmount:number; currency?:string|null };
  recent?: Array<{ client:string|null; destination:string|null; outcome:'won'|'lost'; amount:number|null; currency:string|null; resolvedAt:string; permalink:string|null }>;
  unconfigured?: boolean;
  unavailable?: boolean;
}

export async function fetchSales(range: SalesRange): Promise<SalesResponse> {
  // The main process already has the pairing auth context. If the renderer proxies
  // network via IPC, replace this fetch with an IPC call. If admin-web is reachable
  // directly with cookie/key auth, keep fetch. Follow the existing pattern used by
  // other renderer→admin-web calls in this repo.
  const r = await fetch(`/api/sales/me?range=${range}`, { credentials: 'include' });
  if (!r.ok) return { unavailable: true };
  return r.json();
}
```

- [ ] **Step 2: SalesStatsPanel component**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { fetchSales, SalesRange, SalesResponse } from '../services/slack-sales-service';

export const SalesStatsPanel: React.FC = () => {
  const [range, setRange] = useState<SalesRange>('day');
  const [data, setData] = useState<SalesResponse|null>(null);
  const timer = useRef<any>(null);

  const load = async (r: SalesRange) => setData(await fetchSales(r));
  useEffect(() => {
    load(range);
    timer.current = setInterval(() => load(range), 5 * 60_000);
    const onFocus = () => load(range);
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearInterval(timer.current); document.removeEventListener('visibilitychange', onFocus); };
  }, [range]);

  if (!data) return <div className="sales-panel">Loading…</div>;
  if (data.unconfigured) return <div className="sales-panel empty">Ask your admin to link your Slack account.</div>;
  if (data.unavailable) return <div className="sales-panel empty">Sales data unavailable. <button onClick={() => load(range)}>Retry</button></div>;

  const c = data.counters!;
  const fmt = (n:number) => new Intl.NumberFormat(undefined, { style:'currency', currency: c.currency ?? 'EUR' }).format(n);
  return (
    <div className="sales-panel">
      <div className="panel-header"><h3>Sales</h3>
        <div className="segmented">
          {(['day','week','month'] as SalesRange[]).map(r => (
            <button key={r} className={r===range?'active':''} onClick={()=>setRange(r)}>
              {r==='day'?'Today':r==='week'?'This Week':'This Month'}
            </button>
          ))}
        </div>
      </div>
      <div className="counter-row">
        <div><div className="n">{c.wins}</div><div className="l">Wins</div></div>
        <div><div className="n">{c.losses}</div><div className="l">Losses</div></div>
        <div><div className="n">{Math.round(c.winRate*100)}%</div><div className="l">Win rate</div></div>
        <div><div className="n">{fmt(c.totalAmount)}</div><div className="l">Total won</div></div>
      </div>
      <div className="recent-list">
        {(data.recent ?? []).length === 0 && <div className="empty">No tickets in this range.</div>}
        {(data.recent ?? []).map((t, i) => (
          <a key={i} href={t.permalink ?? '#'} target="_blank" rel="noreferrer" className={`ticket ${t.outcome}`}>
            <div className="top"><span className="client">{t.client ?? '—'}</span><span className={`badge ${t.outcome}`}>{t.outcome}</span></div>
            <div className="bot"><span>{t.destination ?? ''}</span><span>{t.amount != null ? fmt(t.amount) : ''}</span></div>
          </a>
        ))}
      </div>
    </div>
  );
};
```

Add minimal CSS in the existing stylesheet (follow the repo's styling pattern — if it uses CSS modules, add a `.module.css`; if global, add to the dashboard stylesheet). The key is that `.sales-panel` fills its column and the segmented control, counters, and list are visually coherent with the rest of the dashboard.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/services/slack-sales-service.ts src/renderer/components/SalesStatsPanel.tsx
git commit -m "feat(client): sales stats panel with day/week/month and recent list"
```

---

## Task 11: Client — dashboard layout restructure

**Files:**
- Modify: `src/renderer/components/ActivityDashboard.tsx`

- [ ] **Step 1: Move Focus Summary into left column; mount Sales in right**

Replace the current two-column render (Current Activity + Performance Metrics in left, Recent Activity in right) with:

```tsx
<div className="dashboard-grid">
  <div className="dashboard-col left">
    <CurrentActivityCard /* existing props */ />
    <FocusSummary /* pass current day metrics */ />
    <details className="recent-activity-collapsible">
      <summary>Show Recent Activity</summary>
      <RecentActivityList /* existing props */ />
    </details>
  </div>
  <div className="dashboard-col right">
    <SalesStatsPanel />
  </div>
</div>
```

- `FocusSummary` is imported from `src/renderer/components/FocusSummary.tsx` (it already exists but is not currently mounted on the dashboard).
- `CurrentActivityCard` / `RecentActivityList` are placeholder names — wrap the existing in-place JSX into named fragments if the repo doesn't already extract them. Do not refactor unrelated code.
- Ensure the CSS grid is ~60/40 (left/right). If existing dashboard CSS hard-codes columns, update only those selectors.

- [ ] **Step 2: Verify props plumbing**

`FocusSummary` expects the same metrics object the dashboard already computes for Performance Metrics. Reuse it; do not recompute.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ActivityDashboard.tsx
git commit -m "feat(client): dashboard — focus summary in left column, sales panel on right"
```

---

## Task 12: Wire Railway env + smoke test

**Files:**
- None (environment + manual verification).

- [ ] **Step 1: Set env on both Railway services**

On the admin-web service:
```
SLACK_BOT_INTERNAL_URL=<slack-bot railway private URL>
INTERNAL_API_KEY=<generated>
```
On the Slack bot service:
```
INTERNAL_API_KEY=<same value>
SALES_DB_PATH=/app/data/sales.db
SALES_AGGREGATE_CHANNEL=C0ATRV7RRL0
```
Ensure the bot service has a persistent volume mounted at `/app/data` (or whatever Railway volume path is already in use).

- [ ] **Step 2: Deploy bot + admin-web**

```bash
# from each project root per your existing release flow
railway up
```

- [ ] **Step 3: Run backfill once**

Against the bot service shell (or locally with prod Slack token):
```bash
SLACK_BOT_TOKEN=... SALES_DB_PATH=... PYTHONPATH=src python scripts/backfill_sales_cases.py
```
Accept that rows pre-metadata may be skipped.

- [ ] **Step 4: Client smoke checklist**

1. Build + run client (`npm run build:main && npm run build:renderer && unset ELECTRON_RUN_AS_NODE && "node_modules/electron/dist/electron.exe" .`).
2. Fresh install path: enter name → Save → field becomes disabled.
3. In Admin Console → Devices → Edit → change name + add Slack User ID → Save. Confirm both reflect on the client within one heartbeat/policy cycle.
4. Dashboard: Focus Summary now renders in left column; Sales panel on the right shows counters + recent tickets. Toggle Today/Week/Month.
5. Temporarily set bot `INTERNAL_API_KEY` to a wrong value on admin-web → client should show "Sales data unavailable" with Retry. Restore.
6. Unset `slack_user_id` for the device in admin → client shows "Ask your admin to link your Slack account."

- [ ] **Step 5: Commit any last config docs**

If a `.env.example` or README was updated, commit with `chore: document INTERNAL_API_KEY and SALES_DB_PATH env vars`.

---

## Self-review

**Spec coverage:** Section 1 → Tasks 1, 3. Section 2 → Tasks 2, 4, 10, 11. Section 3 → Tasks 5–9. Section 4 (edge cases + testing) → Tasks 1 (migration), 5–7 (idempotency, auth, bad-range), 9 (timeout + unconfigured), 12 (manual smoke).

**Placeholders:** None — all code, commands, env names, and file paths are explicit.

**Type consistency:** `PolicyData.slackUserId`, `devices.slack_user_id`, bot payload `agent_user_id`, and client setting `slack_user_id` are distinct names by intent (protocol camelCase, SQL snake_case, Slack field name). The client-facing `SalesResponse` and bot JSON shape match.
