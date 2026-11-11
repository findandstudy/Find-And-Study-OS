import assert from "node:assert/strict";
import test from "node:test";
import { __test } from "../src/lib/websiteDetailSourceDocuments";

test("converts only canonical Google Sheets links to bounded CSV exports", () => {
  assert.equal(
    __test.googleSheetExportUrl("https://docs.google.com/spreadsheets/d/18mRq1weX4s-j5oatC4WwB8U5UwIlTLbDevv_jV5EG_0/edit?gid=123#gid=123"),
    "https://docs.google.com/spreadsheets/d/18mRq1weX4s-j5oatC4WwB8U5UwIlTLbDevv_jV5EG_0/export?format=csv&gid=123",
  );
  assert.equal(__test.googleSheetExportUrl("https://example.test/spreadsheets/d/not-allowed/edit"), null);
});

test("parses quoted topic rows and requires the stable two-column contract", () => {
  const topics = __test.topicsFromCsv(
    '\uFEFFTopic title,Verified content\r\n"Visa planning","Check the current route, timing and evidence for the exact nationality."\r\n"Living costs","Compare housing, transport and daily expenses before choosing a city."',
    "Verified briefing",
    "https://docs.google.com/spreadsheets/d/18mRq1weX4s-j5oatC4WwB8U5UwIlTLbDevv_jV5EG_0/edit",
  );
  assert.deepEqual(topics.map(topic => topic.topicTitle), ["Visa planning", "Living costs"]);
  assert.match(topics[0]!.verifiedContent, /exact nationality/);
  assert.throws(() => __test.topicsFromCsv("Heading,Body\nVisa,Text", "Source", "https://example.test"), /Topic title/);
});
