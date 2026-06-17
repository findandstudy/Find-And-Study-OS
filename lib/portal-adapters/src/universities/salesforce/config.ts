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
  {
    key: "uskudar",
    label: "Üsküdar Üniversitesi",
    portalUrl: "https://apply.uskudar.edu.tr/agency/s",
    namePatterns: ["uskudar"],
    requiredDocs: ["diploma", "transcript", "passport"],
  },
  {
    key: "aydin",
    label: "İstanbul Aydın Üniversitesi",
    portalUrl: "https://applyonline.aydin.edu.tr/agency/s",
    namePatterns: ["aydin","istanbul aydin"],
    requiredDocs: ["diploma", "transcript", "passport"],
  },
  {
    key: "bau",
    label: "Bahçeşehir Üniversitesi",
    portalUrl: "https://applyonline.bau.edu.tr/agency/s",
    namePatterns: ["bahcesehir","bau"],
    requiredDocs: ["diploma", "transcript", "passport"],
  },
  {
    key: "atlas",
    label: "Atlas Üniversitesi",
    portalUrl: "https://apply.atlas.edu.tr/agency/s",
    namePatterns: ["atlas"],
    requiredDocs: ["diploma", "transcript", "passport"],
  },
  {
    key: "dogus",
    label: "Doğuş Üniversitesi",
    portalUrl: "https://apply.dogus.edu.tr/agency/s",
    namePatterns: ["dogus"],
    requiredDocs: ["diploma", "transcript", "passport"],
  },
  {
    key: "ozyegin",
    label: "Özyeğin Üniversitesi",
    portalUrl: "https://apply.ozyegin.edu.tr/agency/s",
    namePatterns: ["ozyegin"],
    requiredDocs: ["diploma", "transcript", "passport"],
  },
  {
    key: "emu",
    label: "Doğu Akdeniz Üniversitesi (EMU)",
    portalUrl: "https://applyonline.emu.edu.tr/agency",
    namePatterns: ["emu","dogu akdeniz"],
    requiredDocs: ["diploma", "transcript", "passport"],
  },
  {
    key: "altinbas",
    label: "Altınbaş Üniversitesi",
    portalUrl: "https://apply.altinbas.edu.tr/partner/s",
    namePatterns: ["altinbas"],
    requiredDocs: ["diploma", "transcript", "passport"],
  },
  {
    key: "pirireis",
    label: "Piri Reis Üniversitesi",
    portalUrl: "https://apply.pirireis.edu.tr/partner/s",
    namePatterns: ["piri reis","pirireis"],
    requiredDocs: ["diploma", "transcript", "passport"],
  },
  {
    key: "sabanci",
    label: "Sabancı Üniversitesi",
    portalUrl: "https://apply.sabanciuniv.edu/partner/s",
    namePatterns: ["sabanci"],
    requiredDocs: ["diploma", "transcript", "passport"],
  },
  {
    key: "yeditepe",
    label: "Yeditepe Üniversitesi",
    portalUrl: "https://apply.yeditepe.edu.tr/partner/s",
    namePatterns: ["yeditepe"],
    requiredDocs: ["diploma", "transcript", "passport"],
  },
];
