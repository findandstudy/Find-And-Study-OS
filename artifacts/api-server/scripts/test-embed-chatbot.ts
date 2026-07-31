import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createEmbedChatSessionToken,
  requestsEmbedHumanHandoff,
  verifyEmbedChatSessionToken,
} from "../src/lib/embedChatSession";
import {
  EMBED_CHAT_LOCALES,
  getEmbedChatCopy,
  localeFromPublicUrl,
  normalizeEmbedChatLocale,
  resolveEmbedChatLocale,
} from "../src/lib/embedChatI18n";
import { buildKnownEmbedContactInstruction } from "../src/lib/inbox/embedChatIdentityPrompt";

const secret = "embed-chatbot-regression-secret";
const sessionId = "12345678-1234-4abc-8def-1234567890ab";
const routeSource = readFileSync(new URL("../src/routes/embed.ts", import.meta.url), "utf8");
const botSource = readFileSync(
  new URL("../src/lib/inbox/botAutoReply.ts", import.meta.url),
  "utf8",
);
const programToolSource = readFileSync(
  new URL("../src/lib/inbox/programSearchTool.ts", import.meta.url),
  "utf8",
);
const storageSource = readFileSync(
  new URL("../src/routes/storage.ts", import.meta.url),
  "utf8",
);
const embedsAdminSource = readFileSync(
  new URL("../../edcons/src/pages/admin/Embeds.tsx", import.meta.url),
  "utf8",
);

test("chat session tokens are signed, scoped, tamper-evident and expiring", () => {
  const now = Date.UTC(2026, 6, 30, 8, 0, 0);
  const token = createEmbedChatSessionToken(
    secret,
    "beykent-chat",
    sessionId,
    42,
    now,
  );

  assert.deepEqual(
    verifyEmbedChatSessionToken(secret, token, "beykent-chat", now),
    { sessionId, conversationId: 42 },
  );
  assert.equal(verifyEmbedChatSessionToken(secret, token, "isik-chat", now), null);
  assert.equal(
    verifyEmbedChatSessionToken(
      secret,
      `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`,
      "beykent-chat",
      now,
    ),
    null,
  );
  assert.equal(
    verifyEmbedChatSessionToken(
      secret,
      token,
      "beykent-chat",
      now + 24 * 60 * 60 * 1000 + 1,
    ),
    null,
  );
});

test("embedded assistant hands explicit human and distrust requests to staff", () => {
  assert.equal(requestsEmbedHumanHandoff("Can I talk to a real person?"), true);
  assert.equal(requestsEmbedHumanHandoff("Bir insan danışman ile görüşmek istiyorum."), true);
  assert.equal(requestsEmbedHumanHandoff("Je ne vous fais pas confiance."), true);
  assert.equal(requestsEmbedHumanHandoff("لا أثق، أريد التحدث مع شخص"), true);
  assert.equal(requestsEmbedHumanHandoff("Beykent ücretleri nedir?"), false);
});

test("embedded assistant does not re-ask identity collected by the pre-chat form", () => {
  const instruction = buildKnownEmbedContactInstruction({
    displayName: "Ada Lovelace",
    email: "ADA@EXAMPLE.COM",
    phone: "5551112233",
    phoneE164: "+905551112233",
  });

  assert.match(instruction, /Full name: "Ada Lovelace"/);
  assert.match(instruction, /Email: "ada@example\.com"/);
  assert.match(instruction, /Phone: "\+905551112233"/);
  assert.match(instruction, /Never ask the visitor to provide, repeat or confirm it/);
  assert.match(instruction, /Ask only for application information that is still missing/);

  const partial = buildKnownEmbedContactInstruction({
    displayName: "Ada",
    email: null,
    phone: null,
    phoneE164: null,
  });
  assert.match(partial, /Full name: "Ada"/);
  assert.doesNotMatch(partial, /Email:/);
  assert.doesNotMatch(partial, /Phone:/);
  assert.equal(buildKnownEmbedContactInstruction(null), "");
});

test("chatbot route keeps identity, authorization and XSS guards server-owned", () => {
  assert.match(routeSource, /AI chatbot widgets require exactly one universityId preset/);
  assert.match(routeSource, /createEmbedChatSessionToken\(/);
  assert.match(routeSource, /verifyEmbedChatSessionToken\(/);
  assert.match(routeSource, /eq\(embedWidgetsTable\.isActive, true\)/);
  assert.match(routeSource, /e\.source !== iframe\.contentWindow/);
  assert.match(routeSource, /text\.textContent=row\.content\|\|''/);
  assert.match(routeSource, /chat\/handoff/);
  assert.doesNotMatch(routeSource, /CRM kaydınızla güvenli biçimde eşleştirilir/);
  assert.match(routeSource, /data-edcons-lang/);
  assert.match(routeSource, /language:cfg\.locale/);
  assert.match(routeSource, /if \(script\) new Function\(script\)/);
});

test("chatbot uses the shared country-code catalog and stores verified E.164 phones", () => {
  assert.match(routeSource, /const dialRows = await db[\s\S]*countriesTable\.dialCode/);
  assert.match(routeSource, /generateChatbotWidgetHTML\([\s\S]*chatLocale,[\s\S]*dialCodes/);
  assert.match(routeSource, /name="countryCode"/);
  assert.match(routeSource, /countryCode:fd\.get\('countryCode'\)/);
  assert.match(routeSource, /const combinedPhone = cleanCountryCode[\s\S]*pn\(cleanPhone, cleanCountryCode, 50\)/);
  assert.match(routeSource, /const phoneE164 = toE164\(combinedPhone\)/);
  assert.match(routeSource, /phone: phoneE164,[\s\S]*phoneE164,/);
  assert.match(routeSource, /id="dialSearch"/);
  assert.match(routeSource, /phoneInput\.value=raw\.replace\(\/\\\\D\/g,''\)\.slice\(0,15\)/);
  assert.doesNotMatch(routeSource, /name="phone"[^>]*placeholder="\+90\.\.\."/);
});

test("collapsed chatbot launcher has a transparent, shadow-free host canvas", () => {
  assert.match(routeSource, /iframe\.style\.background = 'transparent'/);
  assert.match(routeSource, /iframe\.style\.boxShadow = 'none'/);
  assert.match(routeSource, /iframe\.setAttribute\('allowtransparency', 'true'\)/);
  assert.match(routeSource, /el\.style\.background = 'transparent'/);
  assert.match(routeSource, /\.launcher\{[^}]*box-shadow:none;filter:none\}/);
});

test("embedded assistant resolves all ten public-site languages", () => {
  assert.deepEqual(
    EMBED_CHAT_LOCALES,
    ["en", "tr", "ar", "fa", "fr", "es", "ru", "zh", "hi", "id"],
  );
  assert.equal(normalizeEmbedChatLocale("tr-TR"), "tr");
  assert.equal(normalizeEmbedChatLocale("fa_IR"), "fa");
  assert.equal(normalizeEmbedChatLocale("zh-CN,zh;q=0.9"), "zh");
  assert.equal(localeFromPublicUrl("https://example.com/es/programs"), "es");
  assert.equal(resolveEmbedChatLocale("de-DE", "fr-FR"), "fr");
  assert.equal(resolveEmbedChatLocale("de-DE"), "en");
});

test("localized widget copy is complete, directional and contains no CRM disclosure", () => {
  for (const locale of EMBED_CHAT_LOCALES) {
    const copy = getEmbedChatCopy(locale);
    assert.ok(copy.hello);
    assert.ok(copy.firstName);
    assert.ok(copy.startChat);
    assert.ok(copy.countryCode);
    assert.ok(copy.countrySearch);
    assert.ok(copy.countryNoMatches);
    assert.ok(copy.phonePlaceholder);
    assert.ok(copy.phoneInvalid);
    assert.ok(copy.greeting("Ada", "Example University").includes("Ada"));
    assert.doesNotMatch(
      Object.values(copy).filter((value) => typeof value === "string").join(" "),
      /CRM|mevcut kaydınızla/i,
    );
    assert.equal(copy.dir, locale === "ar" || locale === "fa" ? "rtl" : "ltr");
  }
});

test("assistant logos use an admin-only, image-only upload flow", () => {
  assert.match(storageSource, /prefix === "branding\/embed-widget"/);
  assert.match(storageSource, /Embed branding uploads are admin-only/);
  assert.match(storageSource, /"image\/jpeg"[\s\S]*"image\/png"[\s\S]*"image\/webp"/);
  assert.match(storageSource, /storage\/public-branding/);
  assert.match(storageSource, /!filePath\.startsWith\("embed-widget\/"\)/);
  assert.match(embedsAdminSource, /type="file"/);
  assert.match(embedsAdminSource, /prefix: "branding\/embed-widget"/);
  assert.match(embedsAdminSource, /Use university logo/);
  assert.doesNotMatch(embedsAdminSource, /Logo URL/);
  assert.doesNotMatch(embedsAdminSource, /image\/svg\+xml/);
});

test("university scope is enforced below the prompt layer", () => {
  assert.match(
    botSource,
    /const ragChunks = scopedUniversityId[\s\S]*\? \[\][\s\S]*: await retrieveKnowledgeChunks/,
  );
  assert.match(botSource, /enforcedUniversityId: scopedUniversityId/);
  assert.match(botSource, /requestsEmbedHumanHandoff\(msg\.content\)/);
  assert.match(
    botSource,
    /scopedUniversityId && scopedUniversityName[\s\S]*buildKnownEmbedContactInstruction\(contact\)/,
  );
  assert.match(
    programToolSource,
    /Number\.isInteger\(enforcedUniversityId\)[\s\S]*String\(enforcedUniversityId\)/,
  );
});
