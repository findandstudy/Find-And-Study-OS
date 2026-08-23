import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyTopkapiStudentCheck } from "../src/universities/topkapi/adapter.js";

test("Topkapi duplicate classifier accepts explicit exists/new outcomes", () => {
  assert.equal(classifyTopkapiStudentCheck('{"status":"exists"}'), "exists");
  assert.equal(classifyTopkapiStudentCheck('{"status":"new"}'), "new");
  assert.equal(classifyTopkapiStudentCheck('{"status":"success"}'), "new");
  assert.equal(classifyTopkapiStudentCheck(""), "new");
  assert.equal(classifyTopkapiStudentCheck("null"), "new");
  assert.equal(classifyTopkapiStudentCheck("{}"), "new");
  assert.equal(classifyTopkapiStudentCheck("[]"), "new");
});

test("Topkapi duplicate classifier fails closed on HTML and unknown payloads", () => {
  assert.equal(classifyTopkapiStudentCheck("<html>502 Bad Gateway</html>"), "unknown");
  assert.equal(classifyTopkapiStudentCheck('{"status":"maybe"}'), "unknown");
  assert.equal(classifyTopkapiStudentCheck("{broken"), "unknown");
  assert.equal(classifyTopkapiStudentCheck('[{"status":"exists"}]'), "unknown");
});
