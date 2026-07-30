import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createEmbedChatSessionToken,
  requestsEmbedHumanHandoff,
  verifyEmbedChatSessionToken,
} from "../src/lib/embedChatSession";

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

test("chatbot route keeps identity, authorization and XSS guards server-owned", () => {
  assert.match(routeSource, /AI chatbot widgets require exactly one universityId preset/);
  assert.match(routeSource, /createEmbedChatSessionToken\(/);
  assert.match(routeSource, /verifyEmbedChatSessionToken\(/);
  assert.match(routeSource, /eq\(embedWidgetsTable\.isActive, true\)/);
  assert.match(routeSource, /e\.source !== iframe\.contentWindow/);
  assert.match(routeSource, /text\.textContent=row\.content\|\|''/);
  assert.match(routeSource, /chat\/handoff/);
  assert.match(routeSource, /CRM kaydınızla güvenli biçimde eşleştirilir/);
  assert.match(routeSource, /if \(script\) new Function\(script\)/);
});

test("university scope is enforced below the prompt layer", () => {
  assert.match(
    botSource,
    /const ragChunks = scopedUniversityId[\s\S]*\? \[\][\s\S]*: await retrieveKnowledgeChunks/,
  );
  assert.match(botSource, /enforcedUniversityId: scopedUniversityId/);
  assert.match(botSource, /requestsEmbedHumanHandoff\(msg\.content\)/);
  assert.match(
    programToolSource,
    /Number\.isInteger\(enforcedUniversityId\)[\s\S]*String\(enforcedUniversityId\)/,
  );
});
