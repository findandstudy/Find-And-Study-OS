import assert from "node:assert/strict";
import test from "node:test";
import { voiceRecorderStartError } from "../src/hooks/voice-recorder-errors";

test("recognizes permission denial without relying on DOMException identity", () => {
  assert.match(
    voiceRecorderStartError(
      { name: "NotAllowedError", message: "Permission denied" },
      "permission",
    ),
    /access is blocked/i,
  );
});

test("distinguishes missing and busy microphones", () => {
  assert.match(
    voiceRecorderStartError({ name: "NotFoundError" }, "permission"),
    /No microphone was found/i,
  );
  assert.match(
    voiceRecorderStartError({ name: "NotReadableError" }, "permission"),
    /in use by another app/i,
  );
});

test("reports encoder startup separately from microphone permission", () => {
  assert.match(
    voiceRecorderStartError(new Error("AudioWorklet failed"), "encoder"),
    /encoder could not start/i,
  );
  assert.doesNotMatch(
    voiceRecorderStartError(new Error("AudioWorklet failed"), "encoder"),
    /permission is required/i,
  );
});

test("uses a safe generic message for unknown permission failures", () => {
  assert.equal(
    voiceRecorderStartError("unexpected failure", "permission"),
    "Microphone could not be started. Check browser and macOS microphone permissions, then try again.",
  );
});
