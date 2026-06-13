# Portal Automation — Architecture & Operations Guide

## Overview

The Portal Automation system automates submission of student applications to
external university portals. It consists of three layers:

| Layer | Location | Role |
|---|---|---|
| **API routes** | `artifacts/api-server/src/routes/portalAutomation.ts` + `portalMgmt.ts` | Enqueueing, settings, CRUD |
| **Admin UI** | `artifacts/edcons/src/pages/admin/PortalAutomation.tsx` | Configuration & monitoring |
| **Worker** | `artifacts/portal-automation-worker/` | Headless browser execution |

---

## Database Tables

| Table | Purpose |
|---|---|
| `portal_automation_settings` | Global on/off, mode, scope, trigger stages |
| `portal_universities` | Which universities to submit to + per-uni defaults |
| `portal_program_mapping` | Portal label → CRM program name dictionary per university |
| `portal_adapters` | DB-stored declarative adapter configurations |
| `portal_submissions` | Submission queue + status tracking |

---

## Worker Setup

### Prerequisites

- Node.js 20+
- pnpm
- Sufficient RAM (≥2 GB recommended — Chromium is launched per job)

### Install & Build

```bash
cd artifacts/portal-automation-worker

# Install dependencies
pnpm install

# Build TypeScript + install Playwright Chromium
bash scripts/build.sh
```

### Configuration

Copy `.env.example` to `.env` and fill in the real values:

```bash
cp .env.example .env
# Edit .env — add DATABASE_URL and adapter credentials
```

**Credential format**: For each active portal adapter, set:

```
<ADAPTER_KEY_UPPERCASE>_EMAIL=your-email@example.com
<ADAPTER_KEY_UPPERCASE>_PASSWORD=your-password
```

Replace hyphens with underscores and convert to uppercase.

> **Security**: Never commit `.env`. Credentials must only exist in environment
> variables — they are never stored in the database or returned by any API.

### Start with PM2

```bash
# Start
pm2 start ecosystem.config.cjs

# Monitor
pm2 logs portal-automation-worker --lines 100

# Restart after config change
pm2 restart portal-automation-worker

# Stop
pm2 stop portal-automation-worker
```

---

## Submission Lifecycle

```
Admin triggers / automation rule fires
         │
         ▼
POST /api/applications/:id/portal-submissions
  → INSERT portal_submissions (status=queued)
         │
         ▼
Worker polls: SELECT * FROM portal_submissions WHERE status='queued'
  → UPDATE status=running, locked_at=now()
         │
         ▼
Playwright launches Chromium
  → adapterByKey(universityKey).submit(profile)
         │
    ┌────┴────┐
    ▼         ▼
submitted   failed
    │         │
    └──UPDATE status──┘
         │
         ▼
 (optional) stageWriteback: set application stage in CRM
```

### Statuses

| Status | Meaning |
|---|---|
| `queued` | Waiting to be picked up by the worker |
| `running` | Currently being processed |
| `submitted` | Successfully submitted to the portal |
| `already_exists` | Student already exists in the portal |
| `program_missing` | Program not found in portal (check mapping) |
| `failed` | Submission failed — see `error` field |
| `canceled` | Manually canceled before execution |

### Retry & Cancel

Failed/canceled submissions can be retried via:

```
POST /api/portal-submissions/:id/retry
```

Queued/running submissions can be canceled via:

```
POST /api/portal-submissions/:id/cancel
```

---

## Adapters

### Code Adapters (built-in)

Located in `lib/portal-adapters/src/universities/`. These are TypeScript
classes implementing `PortalAdapter`:

- `sit` — SIT (custom code adapter)
- `united` — United (custom code adapter)
- `salesforce` — Salesforce-based portals

### Declarative Adapters

Configured in `lib/portal-adapters/src/declarativeConfigs.ts` or via the
**Adapter Yönetimi** tab in the admin UI. Declarative adapters use a JSON
config describing steps:

```json
{
  "loginUrl": "https://apply.example.edu.tr/login",
  "steps": [
    { "type": "fill", "selector": "#email", "value": "{{email}}" },
    { "type": "fill", "selector": "#password", "value": "{{password}}" },
    { "type": "click", "selector": "button[type=submit]" },
    { "type": "navigate", "url": "https://apply.example.edu.tr/apply/new" }
  ]
}
```

### Adding a New University

1. Go to **Admin → Portal Automation → Üniversiteler**
2. Click **Üniversite Ekle**
3. Select or create the adapter
4. Set credentials in the worker's `.env`:
   ```
   MYUNI_EMAIL=automation@example.com
   MYUNI_PASSWORD=secret
   ```
5. Test with **Test Login** button

---

## Program Mapping

When a portal uses different program names than the CRM:

1. Go to **Admin → Portal Automation → Program Haritalama**
2. Select the university
3. Add pairs: **Portal Label** → **CRM Program Name**
4. Save

The worker uses this mapping to find the correct portal program when submitting.

---

## Monitoring

- **Başvuru Panosu tab**: Real-time submission queue status
- **Denetim Günlüğü tab**: Full audit trail of all portal automation actions
- **PM2 logs**: `pm2 logs portal-automation-worker`

---

## Dry Run vs Real Mode

| Mode | Effect |
|---|---|
| **Dry Run** | Simulates the full flow but stops before final submit |
| **Real** | Actually submits to the portal — requires `confirm: true` |

The global default is set in **Otomasyon Kuralları → Submission Mode**.
Individual manual triggers always require explicit mode selection.

---

## Security Notes

- Credentials (`_EMAIL`, `_PASSWORD`) are stored **only** in environment variables
- They are **never** returned by any API endpoint (`hasCredentials` boolean only)
- The portal panel never renders credential values in the UI
- All operations are logged in `audit_logs` with actor + IP
- Agent-role users only see submissions for their own applications (RBAC isolation)
