import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parsePipelineFavorites,
  pipelineFavoritesKey,
} from "../../edcons/src/lib/pipelineFavorites";
import { workPipelineTenant } from "../src/lib/workPipelines";
import { pool } from "@workspace/db";
assert.ok(workPipelineTenant());
const credentials = JSON.parse(
  await readFile(
    new URL("../../../.local-work-pipeline-credentials.json", import.meta.url),
    "utf8",
  ),
);
const base = "http://127.0.0.1:8080/api";
async function login(email: string) {
  const init = await fetch(base + "/auth/me");
  const csrf = init.headers
    .getSetCookie()
    .find((c) => c.startsWith("csrf_token="))!
    .split(";")[0];
  const r = await fetch(base + "/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: csrf,
      "x-csrf-token": csrf.split("=")[1],
    },
    body: JSON.stringify({ email, password: credentials.password }),
  });
  assert.equal(r.status, 200);
  const sid = r.headers
    .getSetCookie()
    .find((c) => c.startsWith("sid="))!
    .split(";")[0];
  return async (path: string, status = 200) => {
    const r = await fetch(base + path, {
      headers: { Cookie: `${csrf}; ${sid}` },
    });
    const b = await r.json();
    assert.equal(r.status, status, JSON.stringify(b));
    return b;
  };
}
try {
  const admin = await login("pipeline.admin@example.invalid"),
    outside = await login("pipeline.outside@example.invalid");
  const all = await admin("/work-pipelines");
  assert.ok(all.items.length > 1);
  const ids = all.items.slice(0, 2).map((r: any) => r.document.id);
  const favorite = await admin("/work-pipelines?ids=" + ids.join(","));
  assert.equal(favorite.items.length, 2);
  assert.ok(favorite.items.every((r: any) => ids.includes(r.document.id)));
  assert.equal((await admin("/work-pipelines?ids=")).items.length, 0);
  assert.equal(
    (await outside("/work-pipelines?ids=" + ids.join(","))).items.length,
    0,
  );
  const name = all.items[0].document.name;
  const found = await admin("/work-pipelines?q=" + encodeURIComponent(name));
  assert.ok(found.items.some((r: any) => r.document.id === ids[0]));
  assert.ok(
    found.items.every((r: any) =>
      r.document.name.toLowerCase().includes(name.toLowerCase()),
    ),
  );
  assert.equal(
    (await outside("/work-pipelines?q=" + encodeURIComponent(name))).items
      .length,
    0,
  );
  await admin("/work-pipelines?ids=invalid", 400);
  await admin("/work-pipelines?q=" + "a".repeat(121), 400);
  assert.deepEqual(parsePipelineFavorites(null), []);
  assert.deepEqual(parsePipelineFavorites("broken"), []);
  assert.deepEqual(parsePipelineFavorites('{"id":1}'), []);
  assert.deepEqual(
    parsePipelineFavorites(
      JSON.stringify([ids[0], ids[0], 42, "invalid", ids[1]]),
    ),
    ids,
  );
  assert.notEqual(pipelineFavoritesKey(1), pipelineFavoritesKey(2));
  assert.deepEqual(
    parsePipelineFavorites(
      JSON.stringify(parsePipelineFavorites(JSON.stringify(ids))),
    ),
    ids,
  );
  console.log(
    "PASS: pipeline search, favorite resolution, denied/empty/invalid IDs, per-user preference keys and persistence round-trip (14 checks)",
  );
} finally {
  await pool.end();
}
