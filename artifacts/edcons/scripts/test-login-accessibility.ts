import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const loginSource = readFileSync(
  path.join(packageRoot, "src/pages/auth/Login.tsx"),
  "utf8",
);
const translationsDirectory = path.join(
  packageRoot,
  "src/lib/i18n/translations",
);

test("every login password visibility toggle has an accessible pressed state", () => {
  assert.equal(
    loginSource.match(/onClick=\{\(\) => setShowPassword\(!showPassword\)\}/g)
      ?.length,
    3,
  );
  assert.equal(
    loginSource.match(
      /aria-label=\{showPassword \? t\("login\.hidePassword"\) : t\("login\.showPassword"\)\}/g,
    )?.length,
    3,
  );
  assert.equal(loginSource.match(/aria-pressed=\{showPassword\}/g)?.length, 3);
});

test("all supported languages name both password visibility states", () => {
  const languageFiles = readdirSync(translationsDirectory)
    .filter((file) => file.endsWith(".json"))
    .sort();
  assert.equal(languageFiles.length, 10);

  for (const file of languageFiles) {
    const translation = JSON.parse(
      readFileSync(path.join(translationsDirectory, file), "utf8"),
    );
    assert.equal(typeof translation.login?.showPassword, "string", file);
    assert.equal(typeof translation.login?.hidePassword, "string", file);
    assert.ok(translation.login.showPassword.trim().length > 0, file);
    assert.ok(translation.login.hidePassword.trim().length > 0, file);
    assert.notEqual(
      translation.login.showPassword,
      translation.login.hidePassword,
      file,
    );
  }
});
