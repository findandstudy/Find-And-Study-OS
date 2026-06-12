import type { SubmitFiles } from "../../types.js";

// ---------------------------------------------------------------------------
// Per-school Salesforce portal configuration
// ---------------------------------------------------------------------------
export interface SalesforceSchoolConfig {
  key: string;
  label: string;
  portalUrl: string;
  /** Lower-cased, fold()-normalised fragments used by matches(). */
  namePatterns: string[];
  requiredDocs: (keyof SubmitFiles)[];
}

export const SALESFORCE_SCHOOLS: SalesforceSchoolConfig[] = [
  // -------------------------------------------------------------------------
  // Üsküdar Üniversitesi — CONFIRMED (apply.uskudar.edu.tr)
  // -------------------------------------------------------------------------
  {
    key:          "uskudar",
    label:        "Üsküdar Üniversitesi",
    portalUrl:    "https://apply.uskudar.edu.tr",
    namePatterns: ["uskudar"],
    requiredDocs: ["diploma", "transcript", "passport"],
  },

  // -------------------------------------------------------------------------
  // Other Salesforce-based schools — uncomment and verify when onboarded
  // -------------------------------------------------------------------------
  // {
  //   key:          "okan",
  //   label:        "Okan Üniversitesi",
  //   portalUrl:    "https://apply.okan.edu.tr",
  //   namePatterns: ["okan"],
  //   requiredDocs: ["diploma", "transcript", "passport", "photo"],
  // },
  // {
  //   key:          "medeniyet",
  //   label:        "İstanbul Medeniyet Üniversitesi",
  //   portalUrl:    "https://apply.medeniyet.edu.tr",
  //   namePatterns: ["medeniyet"],
  //   requiredDocs: ["diploma", "transcript", "passport"],
  // },
];
