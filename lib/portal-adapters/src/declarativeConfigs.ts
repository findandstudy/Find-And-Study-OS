/**
 * declarativeConfigs.ts — registered declarative adapter configurations.
 *
 * Two export shapes coexist here:
 *
 *   declarativeConfigs  — legacy DeclarativeConfig[] (old API, kept for
 *                          compatibility while adapters are migrated).
 *
 *   declarativeSpecRaws — AdapterSpec-format raw JSON objects (specVersion 1).
 *                          Parsed + compiled at startup in registry.ts via
 *                          parseAdapterSpec + createSpecAdapter.
 *
 * Env-var convention (set in .env / Replit secrets):
 *   <KEY>_EMAIL (or <KEY>_USER) + <KEY>_PASSWORD
 */

import type { DeclarativeConfig } from "./declarativeAdapter.js";

/**
 * Legacy declarative configs (old DeclarativeConfig format).
 * New portals should be added to declarativeSpecRaws below.
 */
export const declarativeConfigs: DeclarativeConfig[] = [
  // Add legacy-format declarative adapters here (if any).
];

/**
 * AdapterSpec-format (specVersion 1) raw objects. Each entry is parsed and
 * compiled into a UniversityAdapter by registry.ts on startup. Invalid specs
 * are skipped with a console.warn.
 */
export const declarativeSpecRaws: readonly unknown[] = [
  // -------------------------------------------------------------------------
  // Altınbaş University — Salesforce Screen Flow portal (declarative)
  // Replaces the imperative altinbas/adapter.ts. Remains experimental.
  // -------------------------------------------------------------------------
  {
    specVersion: 1,
    meta: {
      key: "altinbas",
      name: "Altınbaş University",
      baseUrl: "https://apply.altinbas.edu.tr",
      panelUrl: "https://apply.altinbas.edu.tr/partner/s/application-form",
      matches: ["altınbaş", "altinbas", "altınbaş üniversitesi"],
      experimental: true,
    },
    auth: {
      loginUrl: "https://apply.altinbas.edu.tr/partner/s/login/",
      loginSteps: [{ action: "waitFor", selector: "body" }],
      sessionStorageKey: "altinbas",
      successUrlContains: "/partner/s/",
    },
    programSelection: { source: "ajaxOptions" },
    steps: [
      { action: "clickCardByText", text: "Fall 2026 - 2027" },
      { action: "clickCardByText", text: "Next" },
      { action: "clickCardByText", textFrom: "profile.level" },
      { action: "clickCardByText", text: "Next" },
      {
        action: "fill",
        selector: "input[type='search']",
        valueFrom: "profile.programName",
        optional: true,
      },
      { action: "clickCardByText", text: "+ Select" },
      { action: "clickCardByText", text: "Save and Next" },
      {
        action: "selectLabel",
        name: "Gender",
        valueFrom: "profile.gender",
        map: { male: "Male", female: "Female" },
      },
      {
        action: "fill",
        selector: "input[name='Date_of_Birth']",
        valueFrom: "profile.dateOfBirth",
        transform: { type: "toDMY" },
      },
      {
        action: "fill",
        selector: "input[name='Passport_Date_of_Issue']",
        valueFrom: "profile.passportIssueDate",
        transform: { type: "toDMY" },
      },
      {
        action: "fill",
        selector: "input[name='Passport_Date_of_Expiry']",
        valueFrom: "profile.passportExpiryDate",
        transform: { type: "toDMY" },
      },
      { action: "lookup", ariaLabel: "Country of Birth", valueFrom: "profile.nationality" },
      { action: "lookup", ariaLabel: "Passport Issuing Country", valueFrom: "profile.nationality" },
      { action: "phone", countryFrom: "profile.nationality", numberFrom: "profile.phone" },
      {
        action: "fill",
        selector: "input[name='Father_Name']",
        valueFrom: "profile.fatherName",
        optional: true,
      },
      {
        action: "fill",
        selector: "input[name='Mother_Name']",
        valueFrom: "profile.motherName",
        optional: true,
      },
      { action: "lookup", ariaLabel: "Address: Country", valueFrom: "profile.nationality" },
      { action: "fill", selector: "input[name='Address_Street']", valueFrom: "profile.address" },
      { action: "clickCardByText", text: "Next" },
      { action: "click", selector: "button:has-text('Submit Application')", final: true },
    ],
    documents: {
      slots: {
        "Passport": { fileField: "passport" },
        "Bachelor Diploma": { fileField: "diploma" },
        "Bachelor Transcript": { fileField: "transcript" },
        "Personal Picture": { fileField: "photo" },
      },
    },
    success: {
      responseUrlIncludes: "/application-form",
      successText: "Completed",
    },
    failure: {
      failureText: "Enter a valid value",
    },
  },
];
