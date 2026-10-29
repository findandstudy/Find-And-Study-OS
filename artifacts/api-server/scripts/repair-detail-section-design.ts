import { stdin } from "node:process";
import {
  parseDetailContent,
  preserveDetailSectionDesign,
  type DetailContent,
} from "../src/lib/websiteDetailContentContract";
import {
  publishDetailContentDraft,
  readDetailContentDraft,
  saveGeneratedDetailContentDraft,
} from "../src/lib/websiteDetailContent";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  if (process.env.ALLOW_DETAIL_DESIGN_REPAIR !== "1") throw new Error("DETAIL_DESIGN_REPAIR_DISABLED");
  const actorId = Number(process.env.DETAIL_DESIGN_REPAIR_ACTOR_ID);
  if (!Number.isSafeInteger(actorId) || actorId <= 0) throw new Error("INVALID_ACTOR_ID");

  const reference = parseDetailContent(JSON.parse(await readStdin()));
  if (!reference) throw new Error("INVALID_REFERENCE_CONTENT");
  const current = await readDetailContentDraft(reference.kind, reference.entityId, reference.locale);
  if (!current.pageId) throw new Error("TARGET_PAGE_NOT_FOUND");

  const referenceByKey = new Map(reference.sections.map(section => [section.key, section] as const));
  const merged: DetailContent = {
    ...current.content,
    sections: current.content.sections.map(section => preserveDetailSectionDesign(section, referenceByKey.get(section.key))),
  };
  const valid = parseDetailContent(merged);
  if (!valid) throw new Error("INVALID_MERGED_CONTENT");

  const saved = await saveGeneratedDetailContentDraft(valid, actorId, current.updatedAt);
  if (!saved.pageId || !saved.digest) throw new Error("DRAFT_SAVE_FAILED");
  await publishDetailContentDraft(saved.pageId, saved.digest, actorId, true);
  process.stdout.write(JSON.stringify({
    status: "published",
    pageId: saved.pageId,
    kind: reference.kind,
    entityId: reference.entityId,
    locale: reference.locale,
    structuredSections: valid.sections.filter(section => section.cards?.length || section.steps?.length || section.table || section.questions?.length || section.images?.length).map(section => section.key),
  }));
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
