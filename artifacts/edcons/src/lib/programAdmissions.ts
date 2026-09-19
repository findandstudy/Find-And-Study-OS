/** Admissions availability does not control catalogue visibility. */
export function programAdmissionsOpen(program: { isActive?: boolean; universityIsActive?: boolean } | null | undefined): boolean {
  return Boolean(program) && program!.isActive !== false && program!.universityIsActive !== false;
}
