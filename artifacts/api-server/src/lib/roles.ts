export const ADMIN_ROLES = ["super_admin", "admin", "manager"] as const;
export const MANAGER_ROLES = ["super_admin", "admin", "manager"] as const;
export const STAFF_ROLES = [
  "super_admin", "admin", "manager",
  "staff", "consultant", "editor", "accountant",
] as const;
export const FINANCE_ROLES = ["super_admin", "admin", "accountant"] as const;
export const CONTENT_ROLES = ["super_admin", "admin", "manager", "editor"] as const;
export const AGENT_ROLES = ["agent", "sub_agent"] as const;
export const STUDENT_ROLES = ["student"] as const;
