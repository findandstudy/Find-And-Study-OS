import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import {
  ChevronDown,
  ChevronUp,
  History,
  Trash2,
  Pencil,
  Plus,
  UserCheck2,
  ArrowRightLeft,
  KeyRound,
  Archive,
  Globe,
  Users,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  resource: "lead" | "student" | "application";
  resourceId: number;
}

interface AuditLogRow {
  id: number;
  action: string;
  resource: string;
  resourceId: number | null;
  changes: any;
  ipAddress: string | null;
  createdAt: string;
  userName: string | null;
}

type ActionMeta = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "neutral" | "positive" | "warning" | "danger" | "info";
};

const ACTION_META: Record<string, ActionMeta> = {
  create_lead: { label: "Lead created", icon: Plus, tone: "positive" },
  update_lead: { label: "Lead updated", icon: Pencil, tone: "info" },
  delete_lead: { label: "Lead deleted", icon: Trash2, tone: "danger" },
  bulk_assign_leads: { label: "Leads bulk-assigned", icon: UserCheck2, tone: "info" },
  bulk_move_leads: { label: "Leads bulk-moved", icon: ArrowRightLeft, tone: "info" },
  convert_lead: { label: "Lead converted to student", icon: ArrowRightLeft, tone: "positive" },
  override_origin: { label: "Origin updated", icon: Globe, tone: "info" },

  create_student: { label: "Student created", icon: Plus, tone: "positive" },
  update_student: { label: "Student updated", icon: Pencil, tone: "info" },
  archive_student: { label: "Student archived", icon: Archive, tone: "warning" },
  bulk_create_students: { label: "Students bulk-created", icon: Users, tone: "positive" },
  bulk_assign_students: { label: "Students bulk-assigned", icon: UserCheck2, tone: "info" },
  bulk_move_students: { label: "Students bulk-moved", icon: ArrowRightLeft, tone: "info" },
  set_password: { label: "Password set", icon: KeyRound, tone: "warning" },

  delete_note: { label: "Note deleted", icon: Trash2, tone: "danger" },
};

const TONE_BADGE: Record<ActionMeta["tone"], string> = {
  neutral: "bg-muted text-foreground/80",
  positive: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-rose-100 text-rose-700",
  info: "bg-sky-100 text-sky-700",
};

const TONE_ICON: Record<ActionMeta["tone"], string> = {
  neutral: "text-muted-foreground bg-muted",
  positive: "text-emerald-600 bg-emerald-50",
  warning: "text-amber-600 bg-amber-50",
  danger: "text-rose-600 bg-rose-50",
  info: "text-sky-600 bg-sky-50",
};

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  nationality: "Nationality",
  status: "Status",
  source: "Source",
  notes: "Notes",
  assignedTo: "Assigned to",
  assignedToId: "Assigned to",
  agentId: "Agent",
  season: "Season",
  estimatedValue: "Estimated value",
  interestedProgram: "Interested program",
  interestedCountry: "Interested country",
  studentId: "Student",
  userId: "User",
  ids: "Items",
  count: "Count",
  contentPreview: "Content",
  isInternal: "Visibility",
  authorId: "Author",
  noteId: "Note",
  linkedExisting: "Linked to existing user",
  createdUser: "Created new user",
  merged: "Merged with existing student",
  old: "Before",
  new: "After",
  originType: "Type",
  originEntityType: "Entity type",
  originEntityId: "Entity",
  originDisplayName: "Name",
};

const HIDDEN_FIELDS = new Set(["noteId", "authorId", "userId", "agentId", "originEntityId", "originEntityType"]);

function parseChanges(raw: any): Record<string, any> | null {
  if (!raw) return null;
  let parsed: any = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed;
}

function humanizeValue(key: string, v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (key === "isInternal") return v === true ? "Private" : "General";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    if (v.length <= 5) return v.join(", ");
    return `${v.slice(0, 5).join(", ")} +${v.length - 5} more`;
  }
  if (typeof v === "object") {
    const entries = Object.entries(v).filter(([, vv]) => vv !== null && vv !== "" && vv !== undefined);
    if (entries.length === 0) return "—";
    return entries.map(([k, vv]) => `${FIELD_LABELS[k] ?? k}: ${humanizeValue(k, vv)}`).join(" · ");
  }
  return String(v);
}

function buildSummary(action: string, changes: Record<string, any> | null): string | null {
  if (!changes) return null;
  switch (action) {
    case "delete_note": {
      const visibility = changes.isInternal ? "private" : "general";
      const preview = typeof changes.contentPreview === "string" ? changes.contentPreview.replace(/\s+/g, " ").trim() : "";
      const snippet = preview ? ` — "${preview.length > 80 ? preview.slice(0, 80) + "…" : preview}"` : "";
      return `Removed a ${visibility} note${snippet}`;
    }
    case "convert_lead": {
      if (changes.merged) return `Merged into existing student #${changes.studentId}`;
      if (changes.studentId) return `Created student #${changes.studentId}`;
      return null;
    }
    case "set_password": {
      if (changes.createdUser) return "Created a new user account and set its password";
      if (changes.linkedExisting) return "Linked to existing user account and set password";
      return "Password updated";
    }
    case "bulk_assign_leads":
    case "bulk_assign_students": {
      const count = Array.isArray(changes.ids) ? changes.ids.length : null;
      return count !== null ? `Assigned ${count} record${count === 1 ? "" : "s"}` : null;
    }
    case "bulk_move_leads":
    case "bulk_move_students": {
      const count = Array.isArray(changes.ids) ? changes.ids.length : null;
      const status = changes.status ? ` to status "${changes.status}"` : "";
      return count !== null ? `Moved ${count} record${count === 1 ? "" : "s"}${status}` : null;
    }
    case "bulk_create_students": {
      return changes.count ? `Imported ${changes.count} student${changes.count === 1 ? "" : "s"}` : null;
    }
    case "override_origin": {
      const newName = changes.new && typeof changes.new === "object" ? (changes.new.originDisplayName || changes.new.originType) : null;
      const oldName = changes.old && typeof changes.old === "object" ? (changes.old.originDisplayName || changes.old.originType) : null;
      if (newName && oldName) return `Changed from "${oldName}" to "${newName}"`;
      if (newName) return `Set to "${newName}"`;
      return null;
    }
    case "update_lead":
    case "update_student": {
      const fields = Object.keys(changes).filter(k => !HIDDEN_FIELDS.has(k));
      if (fields.length === 0) return null;
      if (fields.length === 1) {
        const k = fields[0];
        return `${FIELD_LABELS[k] ?? k}: ${humanizeValue(k, changes[k])}`;
      }
      return `${fields.length} field${fields.length === 1 ? "" : "s"} updated`;
    }
    case "create_lead":
    case "create_student": {
      const name = [changes.firstName, changes.lastName].filter(Boolean).join(" ");
      return name || null;
    }
    default:
      return null;
  }
}

function buildDetails(action: string, changes: Record<string, any> | null): { label: string; value: string }[] {
  if (!changes) return [];
  if (action === "delete_note") return [];
  if (action === "convert_lead") return [];
  if (action === "set_password") return [];
  if (action === "override_origin") return [];

  const isUpdate = action === "update_lead" || action === "update_student";
  const isCreate = action === "create_lead" || action === "create_student";
  const isBulk = action.startsWith("bulk_");

  const entries = Object.entries(changes).filter(([k, v]) => {
    if (HIDDEN_FIELDS.has(k)) return false;
    if (v === null || v === undefined || v === "") return false;
    if (isBulk && (k === "ids" || k === "status" || k === "assignedToId" || k === "count")) return false;
    if (isCreate && (k === "firstName" || k === "lastName")) return false;
    if (isUpdate && Object.keys(changes).filter(kk => !HIDDEN_FIELDS.has(kk)).length === 1) return false;
    return true;
  });

  return entries.map(([k, v]) => ({
    label: FIELD_LABELS[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()),
    value: humanizeValue(k, v),
  }));
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return "";
}

export function AuditLogSection({ resource, resourceId }: Props) {
  const { user } = useAuth(true);
  const [open, setOpen] = useState(false);
  const isAdminLike = user && ["super_admin", "admin"].includes(user.role);

  const { data, isLoading } = useQuery<{ data: AuditLogRow[]; meta?: any }>({
    queryKey: [`/api/audit`, resource, resourceId],
    queryFn: () => customFetch(`/api/audit?resource=${resource}&resourceId=${resourceId}&limit=100`),
    enabled: !!isAdminLike && open,
    staleTime: 30_000,
  });

  if (!isAdminLike) return null;

  const logs = data?.data ?? [];

  return (
    <div className="bg-card rounded-2xl border shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-secondary/30 rounded-2xl transition-colors"
        data-testid="audit-log-toggle"
      >
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold text-foreground">Activity Log</h2>
          {logs.length > 0 && (
            <span className="text-xs text-muted-foreground">({logs.length})</span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t px-4 pb-4 pt-2">
          {isLoading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No activity recorded.</p>
          ) : (
            <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
              {logs.map((log) => {
                const meta = ACTION_META[log.action] ?? { label: log.action.replace(/_/g, " "), icon: History, tone: "neutral" as const };
                const Icon = meta.icon;
                const changes = parseChanges(log.changes);
                const summary = buildSummary(log.action, changes);
                const details = buildDetails(log.action, changes);
                const rel = relativeTime(log.createdAt);
                return (
                  <div key={log.id} className="rounded-xl border bg-card p-3" data-testid={`audit-log-row-${log.id}`}>
                    <div className="flex items-start gap-3">
                      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${TONE_ICON[meta.tone]}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="text-sm font-semibold text-foreground truncate">
                              {log.userName || "System"}
                            </span>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${TONE_BADGE[meta.tone]}`}>
                              {meta.label}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap" title={new Date(log.createdAt).toLocaleString("tr-TR")}>
                            {new Date(log.createdAt).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                            {" "}
                            {new Date(log.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                            {rel && <span className="text-muted-foreground/60"> · {rel}</span>}
                          </span>
                        </div>
                        {summary && (
                          <p className="mt-1 text-sm text-foreground/90 break-words">{summary}</p>
                        )}
                        {details.length > 0 && (
                          <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                            {details.map(({ label, value }) => (
                              <div key={label} className="flex gap-2 text-xs min-w-0">
                                <dt className="text-muted-foreground shrink-0">{label}:</dt>
                                <dd className="text-foreground/85 break-words min-w-0">{value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {!summary && details.length === 0 && (
                          <p className="mt-1 text-xs text-muted-foreground italic">No additional details</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
