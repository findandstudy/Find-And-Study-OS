import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { test } from "node:test";
import {
  buildProposalPdf,
  getProposalDateTime,
  getProposalServiceFee,
  proposalPdfText,
  type ProposalProgramData,
} from "../src/lib/generateProposalPdf";

const sampleProgram: ProposalProgramData = {
  id: 1,
  name: "Bachelor of Business Administration (English)",
  degree: "Bachelor",
  language: "English",
  duration: "48 Months",
  tuitionFee: 6000,
  discountedFee: 5100,
  currency: "USD",
  applicationFee: 100,
  serviceFeeAmount: 250,
  intakes: "Sep",
  universityName: "Altinbas University",
  universityCity: "Istanbul",
  universityCountry: "Turkey",
  universityType: "Private",
  universityStatus: "Open",
};

test("service fee adjustment is PDF-only arithmetic and clamps below zero", () => {
  assert.equal(getProposalServiceFee(sampleProgram, 125, false), 375);
  assert.equal(getProposalServiceFee(sampleProgram, -500, false), null);
});

test("hide service fee always wins over an adjustment", () => {
  assert.equal(getProposalServiceFee(sampleProgram, 10_000, true), null);
});

test("proposal date and time are rendered in Europe/Istanbul", () => {
  const value = getProposalDateTime(new Date("2026-07-28T00:15:00.000Z"));
  assert.deepEqual(value, { date: "28.07.2026", time: "03:15" });
});

test("unsupported PDF glyphs are normalised without changing ASCII data", () => {
  assert.equal(proposalPdfText("İŞ GÜÇ — 2026"), "Is Guc - 2026");
  assert.equal(proposalPdfText("info@example.com"), "info@example.com");
});

test("five-program proposal stays on one page and remains lightweight", async () => {
  const programs = Array.from({ length: 5 }, (_, index) => ({
    ...sampleProgram,
    id: index + 1,
    name: `${sampleProgram.name} ${index + 1}`,
  }));
  const document = await buildProposalPdf({
    programs,
    companyName: "Find And Study",
    companyEmail: "info@findandstudy.com",
    companyPhone: "+90 212 000 00 00",
    companyWebsite: "https://findandstudy.com",
    generatedAt: new Date("2026-07-28T00:15:00.000Z"),
  });
  const bytes = new Uint8Array(document.output("arraybuffer"));
  assert.equal(document.getNumberOfPages(), 1);
  assert.ok(bytes.byteLength > 2_500);
  assert.ok(bytes.byteLength < 250_000, `fixture PDF is unexpectedly large: ${bytes.byteLength} bytes`);
});

test("long comparison repeats cleanly across pages without inflating the file", async () => {
  const universities = [
    ["Altinbas University", "Istanbul", "Turkey"],
    ["Ankara Bilim University", "Ankara", "Turkey"],
    ["Riga Technical University", "Riga", "Latvia"],
  ] as const;
  const programs = Array.from({ length: 24 }, (_, index) => {
    const university = universities[index % universities.length];
    return {
      ...sampleProgram,
      id: index + 1,
      name:
        index % 3 === 0
          ? `Bachelor of International Business Administration and Digital Management ${index + 1}`
          : `${sampleProgram.name} ${index + 1}`,
      degree: index % 5 === 0 ? "Associate" : "Bachelor",
      language: index % 4 === 0 ? "Turkish" : "English",
      intakes: index % 2 === 0 ? "February, September" : "September",
      universityName: university[0],
      universityCity: university[1],
      universityCountry: university[2],
      serviceFeeAmount: index % 4 === 0 ? 0 : 250,
    };
  });
  const document = await buildProposalPdf({
    programs,
    companyName: "Find And Study",
    companyEmail: "info@findandstudy.com",
    companyPhone: "+90 212 000 00 00",
    companyWebsite: "https://findandstudy.com",
    generatedAt: new Date("2026-07-30T09:15:00.000Z"),
  });
  const bytes = new Uint8Array(document.output("arraybuffer"));
  assert.ok(document.getNumberOfPages() >= 3);
  assert.ok(bytes.byteLength < 350_000, `comparison PDF is unexpectedly large: ${bytes.byteLength} bytes`);

  const previewPath = process.env.PROPOSAL_PREVIEW_PATH;
  if (previewPath) {
    await mkdir(dirname(previewPath), { recursive: true });
    await writeFile(previewPath, bytes);
  }
});
