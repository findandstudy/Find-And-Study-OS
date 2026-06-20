---
name: Meta channel shared config (Faz 1 foundation)
description: How Facebook Messenger + Instagram config foundation mirrors WhatsApp in the edcons inbox
---

Faz 1 added config-only foundation for Messenger + Instagram (no message flow).

- Signature verification is shared: `verifyMetaSignature(rawBody, sigHeader, appSecret)` and `META_API_VERSION` live in `artifacts/api-server/src/lib/inbox/channels/meta-shared.ts`. `whatsapp.ts` `verifyWhatsAppSignature` now delegates to it (behavior identical — WA route + tests unchanged).
- Channel constants (incl. messenger, instagram) live in `inbox/channels/constants.ts`.
- New integration keys `facebook_messenger` + `instagram` go in BOTH backend and frontend `LIVE_GATED_KEYS` sets, and get per-key Test handlers in `routes/integrations.ts` (Graph page-name / IG-username lookups, simulated-mode skip).

**Why:** keep one HMAC implementation across all Meta channels so a fix applies everywhere; gate enabling on production like WhatsApp.

**How to apply (frontend i18n pattern):** `IntegrationsManager.tsx` was historically all-hardcoded English. To i18n a card without touching every other card, set optional `i18nKey` + `metaWebhook` on its `IntegrationDef`; resolver helpers `defName/defDesc/fieldLabel` look up `integrationsManager.<i18nKey>.{name,description,fields.<fieldKey>}` and fall back to the static string when the key is absent. The `integrationsManager` namespace is NEW (distinct from the short prod-banner `integrations` namespace) and must exist in all 10 lang files; getTranslation silently falls back to en. Meta webhook callback URL is `/api/webhooks/meta` (single shared route, not per-channel).
