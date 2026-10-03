import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  parseWebFormReplayEnvelope,
  verifyWebFormReplaySignature,
  WEB_FORM_REPLAY_WINDOW_SECONDS,
} from "../src/lib/inbox/channels/webForm";

let passed = 0;
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  passed += 1;
};

const nowMs = Date.UTC(2026, 8, 28, 12, 0, 0);
const timestamp = Math.floor(nowMs / 1000);
const requestId = "req_01K6YJ8JY6YF8M9N5J8M0Q7X1A";
const secret = "0123456789abcdef0123456789abcdef";
const body = Buffer.from('{"email":"student@example.test","message":"hello"}');
const envelope = parseWebFormReplayEnvelope(String(timestamp), requestId, nowMs);
check(envelope?.requestId === requestId, "valid envelope accepted");
check(envelope?.timestamp === timestamp, "timestamp remains canonical seconds");

const signature = crypto
  .createHmac("sha256", secret)
  .update(`${timestamp}.${requestId}.`)
  .update(body)
  .digest("hex");
check(verifyWebFormReplaySignature(body, `v1=${signature}`, secret, envelope!), "v1 signature accepted");
check(!verifyWebFormReplaySignature(Buffer.from("changed"), signature, secret, envelope!), "body mutation rejected");
check(!verifyWebFormReplaySignature(body, signature, `${secret}x`, envelope!), "wrong secret rejected");
check(parseWebFormReplayEnvelope(String(timestamp - WEB_FORM_REPLAY_WINDOW_SECONDS - 1), requestId, nowMs) === null, "stale request rejected");
check(parseWebFormReplayEnvelope(String(timestamp + WEB_FORM_REPLAY_WINDOW_SECONDS + 1), requestId, nowMs) === null, "future request rejected");
check(parseWebFormReplayEnvelope(String(timestamp), "short", nowMs) === null, "short request id rejected");
check(parseWebFormReplayEnvelope("01", requestId, nowMs) === null, "non-canonical timestamp rejected");

console.log(`[web-form-replay] ${passed}/9 PASS`);
