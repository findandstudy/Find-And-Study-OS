import { test } from "node:test";
import assert from "node:assert/strict";
import { extractQueryToken, extractBearerToken } from "../src/lib/apiTokenAuth";

test("extractQueryToken: reads the documented api_key parameter", () => {
  assert.equal(extractQueryToken({ api_key: "fas_live_abc123" }), "fas_live_abc123");
  // Any value is treated as a token attempt (no fas_live_ prefix gate), so an
  // invalid key reaches lookupApiToken and yields the same 401 as the header.
  assert.equal(extractQueryToken({ api_key: "WRONGKEY" }), "WRONGKEY");
  // Whitespace is trimmed.
  assert.equal(extractQueryToken({ api_key: "  fas_live_padded  " }), "fas_live_padded");
});

test("extractQueryToken: apiKey is accepted as a tolerant alias", () => {
  assert.equal(extractQueryToken({ apiKey: "fas_live_xyz" }), "fas_live_xyz");
  // api_key takes precedence over apiKey when both are present.
  assert.equal(extractQueryToken({ api_key: "fas_live_primary", apiKey: "fas_live_alias" }), "fas_live_primary");
});

test("extractQueryToken: array values resolve to the first non-empty string", () => {
  assert.equal(extractQueryToken({ api_key: ["fas_live_first", "fas_live_second"] }), "fas_live_first");
  assert.equal(extractQueryToken({ api_key: ["", "fas_live_second"] }), "fas_live_second");
});

test("extractQueryToken: missing / empty / non-string values yield null", () => {
  assert.equal(extractQueryToken(undefined), null);
  assert.equal(extractQueryToken({}), null);
  assert.equal(extractQueryToken({ api_key: "" }), null);
  assert.equal(extractQueryToken({ api_key: "   " }), null);
  assert.equal(extractQueryToken({ api_key: [] }), null);
  // Nested object (qs deep parsing) is not a usable token.
  assert.equal(extractQueryToken({ api_key: { nested: "x" } }), null);
});

test("extractQueryToken: 'token' param is NOT read (protects public sign/intake links)", () => {
  assert.equal(extractQueryToken({ token: "some-public-sign-code" }), null);
});

test("priority: Bearer header and query extraction are independent sources", () => {
  // The middleware consults the header first and only falls back to the query
  // when the header yields nothing — these helpers are the two sources.
  assert.equal(extractBearerToken("Bearer fas_live_header"), "fas_live_header");
  assert.equal(extractQueryToken({ api_key: "fas_live_query" }), "fas_live_query");
});
