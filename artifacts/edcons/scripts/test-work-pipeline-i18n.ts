import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  SUPPORTED_LANGUAGES,
  RTL_LANGUAGES,
  loadLanguage,
  getTranslation,
} from "../src/lib/i18n/index";
import { workPipelineCopy } from "../src/pages/staff/workPipelinesCopy";
import {
  workPipelineError,
  workPipelineHistory,
} from "../src/lib/workPipelineI18n";
import { localizeNotification } from "../src/lib/notificationLocalization";

for (const lang of SUPPORTED_LANGUAGES) {
  test(`pipeline dictionaries, runtime and notifications: ${lang}`, async () => {
    assert.equal(await loadLanguage(lang), true);
    const dictionary = JSON.parse(
      await readFile(
        new URL(`../src/lib/i18n/translations/${lang}.json`, import.meta.url),
        "utf8",
      ),
    );
    const t = (key: string) => getTranslation(lang, key);
    for (const [key, value] of Object.entries(dictionary.workPipelines)) {
      assert.equal(
        t(`workPipelines.${key}`),
        value,
        `${lang}.${key}: must use its own dictionary`,
      );
      assert.ok(String(value).trim(), `${lang}.${key}: blank value`);
    }
    const copy = workPipelineCopy(t);
    assert.equal(copy.title, dictionary.workPipelines.title);
    assert.equal(copy.save, dictionary.workPipelines.save);
    assert.equal(
      workPipelineError({ status: 409 }, t),
      dictionary.workPipelines.conflict,
    );
    assert.equal(
      workPipelineError({ status: 403 }, t),
      dictionary.workPipelines.forbidden,
    );
    assert.equal(
      workPipelineError({ status: 400 }, t),
      dictionary.workPipelines.invalidInput,
    );
    assert.equal(
      workPipelineHistory("A custom stage → Another custom stage", t),
      "A custom stage → Another custom stage",
    );
    assert.equal(
      workPipelineHistory("email, phone", t),
      `${t("common.email")}, ${t("common.phone")}`,
    );
    for (const [type, key] of [
      ["note_added", "notifyNote"],
      ["follow_up_due", "notifyDue"],
      ["follow_up_scheduled", "notifyScheduled"],
    ]) {
      const rendered = localizeNotification(
        {
          type: `pipeline.${type}`,
          title: "old bilingual stored title",
          body: "old stored body",
        },
        lang,
      );
      assert.equal(rendered.title, dictionary.workPipelines[key]);
      assert.equal(rendered.body, dictionary.workPipelines.notifyBody);
    }
  });
}

test("pipeline surfaces have no Turkish/English switch and use shared RTL state", async () => {
  const files = [
    "pages/staff/WorkPipelines.tsx",
    "pages/staff/WorkPipelineActivity.tsx",
    "pages/staff/WorkPipelineExcel.tsx",
    "pages/staff/WorkPipelinePicker.tsx",
    "pages/staff/useWorkPipelines.ts",
    "components/WorkPipelineDashboardWidget.tsx",
    "components/inbox/WorkPipelineInboxSidebar.tsx",
  ];
  for (const file of files) {
    const source = await readFile(
      new URL(`../src/${file}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /lang\s*===\s*["']tr["']|\btr\s*\?/, file);
  }
  const page = await readFile(
    new URL("../src/pages/staff/WorkPipelines.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /m\.isRTL/);
  assert.ok(RTL_LANGUAGES.includes("ur"));
  const critical = await readFile(new URL("./generate-public-i18n-critical.mjs", import.meta.url), "utf8");
  assert.match(critical, /"phone"/);
  const phone = await readFile(new URL("../src/components/ui/phone-input.tsx", import.meta.url), "utf8");
  assert.match(phone, /t\("phone\.searchCountry"\)/);
  assert.doesNotMatch(phone, /t\("workPipelines\./);
});
