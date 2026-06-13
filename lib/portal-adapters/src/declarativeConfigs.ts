/**
 * declarativeConfigs.ts — registered declarative adapter configurations.
 *
 * Add a new entry here to support a portal without writing a TypeScript
 * adapter class.  Each config is validated at startup by createDeclarativeAdapter().
 *
 * Env-var convention (set in .env / Replit secrets):
 *   <KEY>_EMAIL (or <KEY>_USER) + <KEY>_PASSWORD
 *
 * Example (uncomment and fill when a real portal is ready):
 *
 *   {
 *     key:   "uskudar",
 *     label: "Üsküdar Üniversitesi",
 *     matches: ["uskudar", "üsküdar"],
 *     loginUrl: "https://apply.uskudar.edu.tr/login",
 *     credentials: {
 *       userSelector:   "#email",
 *       passSelector:   "#password",
 *       submitSelector: "button[type=submit]",
 *       afterSelector:  ".dashboard",
 *     },
 *     steps: [
 *       { type: "navigate", url: "https://apply.uskudar.edu.tr/apply/new" },
 *       { type: "fill",   selector: "#firstName",   field: "firstName"   },
 *       { type: "fill",   selector: "#lastName",    field: "lastName"    },
 *       { type: "fill",   selector: "#email",       field: "email"       },
 *       { type: "fill",   selector: "#passport",    field: "passportNumber" },
 *       { type: "fill",   selector: "#dob",         field: "dateOfBirth" },
 *       { type: "select", selector: "#gender",      field: "gender"      },
 *       { type: "select", selector: "#program",     field: "programId"   },
 *       { type: "upload", selector: "#passportFile", fileField: "passport" },
 *       { type: "upload", selector: "#transcriptFile", fileField: "transcript" },
 *       { type: "click",  selector: "#submitButton" },
 *     ],
 *     submitCheck: {
 *       successText:        "başvurunuz alınmıştır",
 *       alreadyExistsText:  "kayıtlı öğrenci",
 *       programMissingText: "program bulunamadı",
 *     },
 *   },
 */

import type { DeclarativeConfig } from "./declarativeAdapter.js";

/**
 * The canonical list of declarative portal configurations.
 * Code-based adapters (topkapi, salesforce, sit, united) are registered
 * separately in registry.ts and always take priority.
 */
export const declarativeConfigs: DeclarativeConfig[] = [
  // Add declarative adapters here when portals are onboarded.
];
