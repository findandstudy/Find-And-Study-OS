export type CourseFinderProgramVisibility = {
  contacts: boolean;
  internalFees: boolean;
  serviceFee: boolean;
};

const CONTACT_FIELDS = [
  "universityContactName",
  "universityContactPhone",
  "universityContactEmail",
] as const;

const INTERNAL_FEE_FIELDS = [
  "commissionRate",
  "applicationFee",
] as const;

/**
 * Removes private Course Finder fields before the response leaves the API.
 * The UI also applies role-based visibility, but this server-side boundary is
 * what prevents students and anonymous visitors from reading values directly.
 */
export function sanitizeCourseFinderProgram<T extends object>(
  row: T,
  visibility: CourseFinderProgramVisibility,
): Partial<T> {
  const result = { ...row } as Record<string, unknown>;
  if (!visibility.contacts) {
    for (const field of CONTACT_FIELDS) delete result[field];
  }
  if (!visibility.internalFees) {
    for (const field of INTERNAL_FEE_FIELDS) delete result[field];
  }
  if (!visibility.serviceFee) {
    delete result.serviceFeeAmount;
  }
  return result as Partial<T>;
}
