import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export type ProgramDocMeta = {
  key: string;
  label: string;
  icon: string;
  accept: string;
};

export const PROGRAM_DOC_META: Record<string, ProgramDocMeta> = {
  high_school_diploma_translation: { key: "high_school_diploma_translation", label: "HS Diploma (Translation)", icon: "🎓", accept: ".pdf,.jpg,.jpeg,.png" },
  class_10th_ssc_marks_sheet:       { key: "class_10th_ssc_marks_sheet",       label: "Class 10 / SSC Marks Sheet", icon: "📋", accept: ".pdf,.jpg,.jpeg,.png" },
  class_12th_hsc_certificate:       { key: "class_12th_hsc_certificate",       label: "Class 12 / HSC Certificate", icon: "🎓", accept: ".pdf,.jpg,.jpeg,.png" },
  class_12th_hsc_marks_sheet:       { key: "class_12th_hsc_marks_sheet",       label: "Class 12 / HSC Marks Sheet", icon: "📋", accept: ".pdf,.jpg,.jpeg,.png" },
  diploma_certificate:              { key: "diploma_certificate",              label: "Diploma Certificate", icon: "🎓", accept: ".pdf,.jpg,.jpeg,.png" },
  diploma_transcript:               { key: "diploma_transcript",               label: "Diploma Transcript", icon: "📋", accept: ".pdf,.jpg,.jpeg,.png" },
  bachelors_certificate:            { key: "bachelors_certificate",            label: "Bachelor's Certificate", icon: "🎓", accept: ".pdf,.jpg,.jpeg,.png" },
  bachelors_transcript:             { key: "bachelors_transcript",             label: "Bachelor's Transcript", icon: "📋", accept: ".pdf,.jpg,.jpeg,.png" },
  bachelors_provisional_certificate:{ key: "bachelors_provisional_certificate",label: "Bachelor's Provisional Cert.", icon: "🎓", accept: ".pdf,.jpg,.jpeg,.png" },
  bachelors_transcript_all_semesters:{ key: "bachelors_transcript_all_semesters",label: "Bachelor's Transcript (All Sem.)", icon: "📋", accept: ".pdf,.jpg,.jpeg,.png" },
  masters_certificate:              { key: "masters_certificate",              label: "Master's Certificate", icon: "🎓", accept: ".pdf,.jpg,.jpeg,.png" },
  masters_transcript:               { key: "masters_transcript",               label: "Master's Transcript", icon: "📋", accept: ".pdf,.jpg,.jpeg,.png" },
  masters_provisional_certificate:  { key: "masters_provisional_certificate",  label: "Master's Provisional Cert.", icon: "🎓", accept: ".pdf,.jpg,.jpeg,.png" },
  masters_transcript_all_semesters: { key: "masters_transcript_all_semesters", label: "Master's Transcript (All Sem.)", icon: "📋", accept: ".pdf,.jpg,.jpeg,.png" },
  passport:                         { key: "passport",                         label: "Passport", icon: "🛂", accept: ".pdf,.jpg,.jpeg,.png" },
  cv:                               { key: "cv",                               label: "CV / Resume", icon: "📄", accept: ".pdf,.jpg,.jpeg,.png" },
  lor:                              { key: "lor",                              label: "Recommendation Letter", icon: "📝", accept: ".pdf,.jpg,.jpeg,.png" },
  sop:                              { key: "sop",                              label: "Statement of Purpose", icon: "✍️", accept: ".pdf,.jpg,.jpeg,.png" },
  essay:                            { key: "essay",                            label: "Essay", icon: "📝", accept: ".pdf,.jpg,.jpeg,.png" },
  experience_letters:               { key: "experience_letters",               label: "Experience Letters", icon: "💼", accept: ".pdf,.jpg,.jpeg,.png" },
  other_certificates_documents:     { key: "other_certificates_documents",     label: "Other Certificates", icon: "📑", accept: ".pdf,.jpg,.jpeg,.png" },
  ielts_pte_gre_gmat_toefl_duolingo:{ key: "ielts_pte_gre_gmat_toefl_duolingo",label: "Language/Test Score", icon: "🌐", accept: ".pdf,.jpg,.jpeg,.png" },
  photo:                            { key: "photo",                            label: "Photograph", icon: "📷", accept: ".jpg,.jpeg,.png" },
  diploma_recognition:              { key: "diploma_recognition",              label: "Diploma Recognition", icon: "📜", accept: ".pdf,.jpg,.jpeg,.png" },
};

export type ProgramDocReq = { documentType: string; mandatory: boolean; sortOrder?: number };

export function useProgramDocRequirements(programId: number | null | undefined) {
  return useQuery<ProgramDocReq[]>({
    queryKey: ["program-document-requirements", programId],
    queryFn: async () => {
      if (!programId) return [];
      try {
        const res = await customFetch(`${BASE_URL}/api/programs/${programId}/document-requirements`) as unknown;
        if (!Array.isArray(res)) return [];
        return res
          .filter((r): r is { documentType: unknown; mandatory: unknown; sortOrder?: unknown } =>
            !!r && typeof r === "object" && typeof (r as any).documentType === "string")
          .map(r => ({
            documentType: r.documentType as string,
            mandatory: !!r.mandatory,
            sortOrder: typeof (r as any).sortOrder === "number" ? (r as any).sortOrder : undefined,
          }));
      } catch {
        return [];
      }
    },
    enabled: !!programId,
    staleTime: 60_000,
  });
}

/**
 * Resolve the canonical doc-type meta for a `documentType` key. Falls back
 * to a humanised label/generic icon when the key isn't in the canonical
 * PROGRAM_DOC_META map (forwards-compatible if the backend adds new types).
 */
export function resolveDocMeta(documentType: string): ProgramDocMeta {
  const known = PROGRAM_DOC_META[documentType];
  if (known) return known;
  const label = documentType
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
  return { key: documentType, label, icon: "📄", accept: ".pdf,.jpg,.jpeg,.png" };
}
