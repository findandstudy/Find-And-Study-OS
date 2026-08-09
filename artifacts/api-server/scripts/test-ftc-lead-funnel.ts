import assert from "node:assert/strict";
import test from "node:test";
import {
  extractGa4AnalyticsContext,
  isFtcEmbedSource,
  mapLeadStageToGa4Event,
  sanitizeGa4AnalyticsContext,
} from "../src/lib/ga4LeadTracking";
import { getFtcAutomationForSource } from "../src/lib/ftcLeadAutomationConfig";
import { buildFtcLeadAcknowledgementEmail } from "../src/lib/ftcLeadEmail";

test("maps the configured CRM funnel to recommended GA4 lead events", () => {
  assert.equal(mapLeadStageToGa4Event({ key: "contacted" }), "working_lead");
  assert.equal(mapLeadStageToGa4Event({ key: "interested" }), "qualify_lead");
  assert.equal(mapLeadStageToGa4Event({ key: "anything", variant: "won" }), "close_convert_lead");
  assert.equal(mapLeadStageToGa4Event({ key: "anything", variant: "lost" }), "disqualify_lead");
  assert.equal(mapLeadStageToGa4Event({ key: "custom" }), "lead_stage_changed");
});

test("accepts only non-PII GA identifiers and extracts the stored context", () => {
  const context = sanitizeGa4AnalyticsContext({
    gaClientId: "123456789.987654321",
    gaSessionId: "1786265058",
    gaCapturedAt: "2026-08-09T08:00:00.000Z",
  });
  assert.deepEqual(context, {
    clientId: "123456789.987654321",
    sessionId: "1786265058",
    capturedAt: "2026-08-09T08:00:00.000Z",
  });
  assert.equal(sanitizeGa4AnalyticsContext({ gaClientId: "person@example.com" }), null);
  assert.equal(sanitizeGa4AnalyticsContext({ gaClientId: "123.456", gaCapturedAt: "not-a-date" }), null);
  assert.deepEqual(extractGa4AnalyticsContext({ analytics: { ga4: context } }), context);
});

test("limits automation to the three FTC services", () => {
  for (const source of ["embed:ftc-study", "embed:ftc-accommodation", "embed:ftc-transfer"]) {
    assert.equal(isFtcEmbedSource(source), true);
    assert.ok(getFtcAutomationForSource(source));
  }
  assert.equal(isFtcEmbedSource("embed:another-widget"), false);
  assert.equal(getFtcAutomationForSource("website"), null);
});

test("builds a branded transactional email without allowing name markup", () => {
  const config = getFtcAutomationForSource("embed:ftc-study");
  assert.ok(config);
  const email = buildFtcLeadAcknowledgementEmail("<img src=x>", config);
  assert.match(email.html, /https:\/\/freeturkishcourse\.com\/logo\.png/);
  assert.doesNotMatch(email.html, /Hi <img src=x>/);
  assert.match(email.html, /Hi &lt;img src=x&gt;/);
  assert.match(email.text, /service message/);
});
