import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dashboardActivityLabels, dashboardActivityHref } from "../src/lib/dashboardLocalization";
import { SUPPORTED_LANGUAGES } from "../src/lib/i18n/index";

function translator(lang: string) {
  const pack = JSON.parse(readFileSync(new URL(`../src/lib/i18n/translations/${lang}.json`, import.meta.url), "utf8"));
  return (key: string): string => {
    const value = key.split(".").reduce((obj, part) => obj?.[part], pack);
    assert.equal(typeof value, "string", `${lang}:${key}`);
    assert.ok(value.trim());
    return value;
  };
}

test("dashboard labels resolve in every supported locale without English fallback", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const t = translator(lang);
    for (const key of ["users", "leads", "applications", "finance", "settings", "auditLog"]) t(`dashboard.${key}`);
    for (const key of ["latestStudents", "noStudents", "latestUpdates", "noUpdates", "notifications", "noNotifications"]) t(`staffDash.${key}`);
    for (const [action, resource] of [["auth.login.success", "user"], ["auth.logout", "user"], ["platform_config.settings.update", "settings"], ["update_application", "application"], ["create_lead", "lead"], ["create_student", "student"]]) {
      const result = dashboardActivityLabels(action, resource, t);
      assert.notEqual(result.actionLabel, action);
    }
    new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" }).format(new Date());
  }
});

test("Russian and Hindi use their existing native labels", () => {
  for (const lang of ["ru", "hi"]) {
    const t = translator(lang);
    assert.notEqual(t("staffDash.latestStudents"), translator("en")("staffDash.latestStudents"));
    assert.notEqual(dashboardActivityLabels("update_user", "user", t).actionLabel, "Update");
  }
});

test("unmapped audit codes stay exact, without inventing a translation", () => {
  assert.deepEqual(dashboardActivityLabels("custom.event", "custom_resource", translator("ru")), { actionLabel: "custom.event", resourceLabel: "custom_resource" });
  assert.deepEqual(dashboardActivityLabels("constructor", "__proto__", translator("ru")), { actionLabel: "constructor", resourceLabel: "__proto__" });
});

test("activity links cannot generate staff double slash routes", () => {
  assert.equal(dashboardActivityHref("staff", "user", 1), null);
  assert.equal(dashboardActivityHref("staff", "constructor", 1), null);
  assert.equal(dashboardActivityHref("agent", "student", 7), "/agent/students/7");
  assert.equal(dashboardActivityHref("staff", "application", -1), null);
});

test("dashboard source uses translations and locale-aware time", () => {
  const source = readFileSync(new URL("../src/pages/admin/Dashboard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, />(Latest Students|Latest Updates|Notifications|No notifications\.|Leads|Applications)</);
  assert.doesNotMatch(source, /label: "(Users|Leads|Applications|Finance|Settings|Audit Log)"/);
  assert.doesNotMatch(source, /toLocaleTimeString\("(?:en-US|tr-TR)"/);
  for (const role of ["admin", "agent", "staff"]) {
    assert.match(readFileSync(new URL(`../src/pages/${role}/Dashboard.tsx`, import.meta.url), "utf8"), /dashboardActivityLabels\(u.action/);
  }
});
