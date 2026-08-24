import { fold } from "./programMatch.js";
import type { SubmitFiles } from "./types.js";

export type DocType = keyof SubmitFiles;

export function mapDocType(raw: string): DocType | null {
  const f = fold(raw);
  if (/photo|resim|fotograf|foto\b/.test(f)) return "photo";
  if (/passport|pasaport/.test(f)) return "passport";
  if (/transcript|marks|marksheet|result|grade|hsc/.test(f)) return "transcript";
  if (/diploma|degree|mezuniyet|certificate|translation/.test(f)) return "diploma";
  if (/ielts|toefl|yds|yokdil|english|language|proficiency|dil belge|dil yeterlilik/.test(f)) return "english";
  if (/motivation|niyet|statement of purpose|\bsop\b|cover letter|onyazi/.test(f)) return "motivation";
  if (/recommendation|reference|tavsiye|referans/.test(f)) return "recommendation";
  return null;
}

export const REQUIRED_DOCS: DocType[] = ["photo", "passport", "transcript", "diploma"];
