// ---------------------------------------------------------------------------
// Altınbaş Screen Flow — alan kontratı (canlı yakalandı 2026-07-10).
//
// Her ekran geçişi navigateFlow POST'unda DÜZ METİN `fields` taşır; bu modül
// bizim SubmitProfile verimizi o alan adlarına çevirir. Formatlar KRİTİK:
//   - Tarihler ISO "YYYY-MM-DD" (UI farklı gösterse de payload ISO).
//   - Ülke picklist deseni ÜÇ alan birden:
//       <F>.<Group>.<CountryEn>.selected = true
//       <F>.selectedChoiceLabels = "<CountryEn>"
//       <F>.selectedChoiceValues = "<CountryEn>"
//   - Telefon: phoneWithCountryCode.selectedCountryCode = "93",
//     phoneWithCountryCode.phone = "93706620293" (kod PREFIX'li tam numara).
//   - Email READ-ONLY pre-filled → HİÇ dokunulmaz.
// ---------------------------------------------------------------------------

import type { SubmitProfile } from "../../types.js";

/** One plain-text field entry inside navigateFlow params.request.fields. */
export interface FlowField {
  field: string;
  value: unknown;
  isVisible: boolean;
}

// ---------------------------------------------------------------------------
// Country normalisation — portal picklists use plain ENGLISH country names.
// ---------------------------------------------------------------------------
const COUNTRY_EN_MAP: Record<string, string> = {
  afghan: "Afghanistan", algerian: "Algeria", azerbaijani: "Azerbaijan",
  bahraini: "Bahrain", bangladeshi: "Bangladesh", british: "United Kingdom",
  chinese: "China", egyptian: "Egypt", emirati: "United Arab Emirates",
  french: "France", german: "Germany", indian: "India", iranian: "Iran",
  iraqi: "Iraq", jordanian: "Jordan", kazakh: "Kazakhstan", kenyan: "Kenya",
  kuwaiti: "Kuwait", kyrgyz: "Kyrgyzstan", lebanese: "Lebanon",
  libyan: "Libya", moroccan: "Morocco", nigerian: "Nigeria", omani: "Oman",
  pakistani: "Pakistan", palestinian: "Palestine", qatari: "Qatar",
  russian: "Russia", saudi: "Saudi Arabia", somali: "Somalia",
  sudanese: "Sudan", syrian: "Syria", tajik: "Tajikistan",
  tunisian: "Tunisia", turk: "Turkey", turkish: "Turkey",
  turkmen: "Turkmenistan", ukrainian: "Ukraine", uzbek: "Uzbekistan",
  yemeni: "Yemen",
};

/** Normalise a nationality string to the English country name the portal expects. */
export function mapCountry(nationality?: string): string {
  if (!nationality) return "";
  const lower = nationality.trim().toLowerCase();
  return COUNTRY_EN_MAP[lower] || nationality.trim();
}

/** Dial codes for phoneWithCountryCode.selectedCountryCode. */
export const DIAL_CODES: Record<string, string> = {
  Afghanistan: "93", Algeria: "213", Azerbaijan: "994", Bahrain: "973",
  Bangladesh: "880", "United Kingdom": "44", China: "86", Egypt: "20",
  "United Arab Emirates": "971", France: "33", Germany: "49", India: "91",
  Iran: "98", Iraq: "964", Jordan: "962", Kazakhstan: "7", Kenya: "254",
  Kuwait: "965", Kyrgyzstan: "996", Lebanon: "961", Libya: "218",
  Morocco: "212", Nigeria: "234", Oman: "968", Pakistan: "92",
  Palestine: "970", Qatar: "974", Russia: "7", "Saudi Arabia": "966",
  Somalia: "252", Sudan: "249", Syria: "963", Tajikistan: "992",
  Tunisia: "216", Turkey: "90", Turkmenistan: "993", Ukraine: "380",
  Uzbekistan: "998", Yemen: "967",
};

/** "+930706620293" + "93" → "706620293" (ülke kodu + baştaki trunk 0'lar atılır). */
export function toNationalNoTrunk(phone: string, dialCode: string): string {
  let n = (phone || "").replace(/[^\d]/g, "");
  const dc = (dialCode || "").replace(/[^\d]/g, "");
  if (dc && n.startsWith(dc)) n = n.slice(dc.length);
  n = n.replace(/^0+/, "");
  return n;
}

/** Ülke picklist ÜÇLÜ deseni — her ülke alanı için üç field birden gider. */
export function countryPick(fieldName: string, group: string, country: string): FlowField[] {
  return [
    { field: `${fieldName}.${group}.${country}.selected`, value: true, isVisible: true },
    { field: `${fieldName}.selectedChoiceLabels`, value: country, isVisible: true },
    { field: `${fieldName}.selectedChoiceValues`, value: country, isVisible: true },
  ];
}

// ---------------------------------------------------------------------------
// Screen 1 — Term Selection (action: NEXT)
// ---------------------------------------------------------------------------
export function buildTermFields(term: { label: string; id: string }): FlowField[] {
  return [
    { field: "pathLWC.currentStage", value: "Term Selection", isVisible: true },
    { field: "TermSelector.selectedOption", value: term.label, isVisible: true },
    { field: "TermSelector.selectedOptionId", value: term.id, isVisible: true },
    { field: "TermSelector.maxSelections", value: 3, isVisible: true },
    { field: "TermSelector.uniMaxSelection", value: 3, isVisible: true },
  ];
}

// ---------------------------------------------------------------------------
// Screen 2 — Degree Selection (action: NEXT)
// ---------------------------------------------------------------------------
export function buildDegreeFields(degree: { label: string; id: string }): FlowField[] {
  return [
    { field: "pathLWC2.currentStage", value: "Degree Selection", isVisible: true },
    { field: "DegreeSelector.selectedOption", value: degree.label, isVisible: true },
    { field: "DegreeSelector.selectedOptionId", value: degree.id, isVisible: true },
  ];
}

// ---------------------------------------------------------------------------
// Screen 3 — Program Selection (action: NEXT, sonra CONTINUE_AFTER_COMMIT)
// programRecord = flow'un client-side yüklediği eligible listeden BULUNAN kayıt
// (en az Id / Name / eduhub__Program__c taşır) — olduğu gibi geri gönderilir.
// ---------------------------------------------------------------------------
export function buildProgramFields(programRecord: Record<string, unknown>): FlowField[] {
  return [
    { field: "pathLWC3.currentStage", value: "Program Selection", isVisible: true },
    { field: "ProgramSelection.selectedPrograms", value: [programRecord], isVisible: true },
  ];
}

// ---------------------------------------------------------------------------
// Screen 4 — Personal Information (action: NEXT)
// ---------------------------------------------------------------------------
export function buildPersonalFields(profile: SubmitProfile): FlowField[] {
  const country = mapCountry(profile.nationality) || "Turkey";
  const dial = DIAL_CODES[country] || "";
  const national = toNationalNoTrunk(profile.phone || "", dial);
  const female = /^f/i.test((profile.gender || "").trim());
  const addrParts = (profile.address || "").split(",").map((s) => s.trim()).filter(Boolean);

  return [
    { field: "path.currentStage", value: "Personal Information", isVisible: true },
    { field: "First_Name", value: profile.firstName, isVisible: true },
    { field: "Last_Name", value: profile.lastName, isVisible: true },
    { field: "Preferred_Name", value: null, isVisible: true },
    { field: `Gender.GenderChoice.${female ? "Female" : "Male"}.selected`, value: true, isVisible: true },
    { field: "Date_of_Birth", value: profile.dateOfBirth || "", isVisible: true },
    ...countryPick("Country_of_Birth", "CountryList", country),
    { field: "City_of_Birth", value: "", isVisible: true },
    ...countryPick("Citizenship_CL", "CountryList", country),
    { field: "Secondary_Citizenship.selectedChoiceLabels", value: "", isVisible: true },
    { field: "Secondary_Citizenship.selectedChoiceValues", value: "", isVisible: true },
    { field: "National_Identity_Number", value: null, isVisible: true },
    { field: "Passport", value: profile.passportNumber, isVisible: true },
    { field: "Passport_Date_of_Issue", value: profile.passportIssueDate || "", isVisible: true },
    { field: "Passport_Date_of_Expiry", value: profile.passportExpiryDate || "", isVisible: true },
    ...countryPick("Passport_Issuing_Country", "IssuingCountry", country),
    // Email READ-ONLY pre-filled — kontrata göre HİÇ gönderilmez/dokunulmaz.
    { field: "phoneWithCountryCode.selectedCountryCode", value: dial, isVisible: true },
    { field: "phoneWithCountryCode.phone", value: `${dial}${national}`, isVisible: true },
    { field: "Father_Name", value: profile.fatherName || "-", isVisible: true },
    { field: "Mother_Name", value: profile.motherName || "-", isVisible: true },
    ...countryPick("Address_Country", "CountryList", country),
    { field: "Address_City", value: addrParts[addrParts.length - 1] || "N/A", isVisible: true },
    { field: "Address_Street", value: addrParts[0] || profile.address || "N/A", isVisible: true },
    // Canlı yakalanan başarılı payload'da "1000001" gitti — zip yoksa onu kullan.
    { field: "Address_Zip_Code", value: "1000001", isVisible: true },
    { field: "I_am_Alumni", value: null, isVisible: true },
  ];
}

// ---------------------------------------------------------------------------
// Screen 5 — Educational Information (action: NEXT) — alt-kayıtlar opsiyonel;
// boş geçilirken SADECE liste ID binding'leri gider.
// ---------------------------------------------------------------------------
export interface FlowIds {
  applicantId?: string;
  applicationId?: string;
  accountId?: string;
  contactId?: string;
}

export function buildEducationalFields(ids: FlowIds): FlowField[] {
  const lists: Array<{ name: string; cvType: string }> = [
    { name: "EducationalInformationList", cvType: "Educational_Information" },
    { name: "ExamInformationList", cvType: "Proficiency_Exam" },
    { name: "ExperienceList", cvType: "Job_Information" },
    { name: "ReferenceList", cvType: "Reference" },
  ];
  const fields: FlowField[] = [
    { field: "path1.currentStage", value: "Educational Information", isVisible: true },
  ];
  for (const l of lists) {
    fields.push(
      { field: `${l.name}.applicantId`, value: ids.applicantId ?? "", isVisible: true },
      { field: `${l.name}.applicationId`, value: ids.applicationId ?? "", isVisible: true },
      { field: `${l.name}.cvType`, value: l.cvType, isVisible: true },
      { field: `${l.name}.language`, value: "en_US", isVisible: true },
    );
  }
  fields.push(
    { field: "SetCookie.accountId", value: ids.accountId ?? "", isVisible: true },
    { field: "SetCookie.contactId", value: ids.contactId ?? "", isVisible: true },
  );
  return fields;
}

// ---------------------------------------------------------------------------
// Screen 6 — Questionnaire (action: NEXT). Sorular flow'a önceden yüklü;
// zorunlu cevap şekli henüz canlı yakalanmadı → boş dene, hata olursa
// ALTINBAS_CAPTURE=1 run'ından responseQuestions şekli alınıp buraya eklenir.
// ---------------------------------------------------------------------------
export function buildQuestionnaireFields(): FlowField[] {
  return [];
}

// ---------------------------------------------------------------------------
// Screen 7 — Documents (action: NEXT). Belge upload = Salesforce ContentVersion
// insert (base64) — HENÜZ canlı yakalanmadı; ilk capture run'ından eklenecek.
// Şimdilik belgesiz geçilir (Upload.recordsCV boş).
// ---------------------------------------------------------------------------
export function buildDocumentsFields(): FlowField[] {
  return [];
}
