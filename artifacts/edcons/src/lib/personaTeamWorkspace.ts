import { z } from "zod";
import {
  addDesignerMember,
  layoutDesignerTeam,
  validateDesignerTeam,
  type DesignerTeam,
} from "./personaTeamDesigner";

const key = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
const layoutSchema = z
  .object({
    positions: z
      .array(
        z
          .object({
            key,
            x: z.number().finite().min(0).max(3800),
            y: z.number().finite().min(0).max(3800),
          })
          .strict(),
      )
      .max(20),
    zoom: z.number().finite().min(0.25).max(2),
    selectedKey: key.nullable(),
  })
  .strict();
export type WorkspaceLayout = z.infer<typeof layoutSchema>;
export type WorkspaceValue = {
  document: DesignerTeam;
  layout: WorkspaceLayout;
};
export type WorkspaceRecord = WorkspaceValue & {
  revision: number;
  updatedAt: string;
};
const projectSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

export function workspaceApiPath(project: string) {
  return `/api/persona-workspace/${projectSchema.parse(project)}/team-workspace`;
}
export function workspaceTaskPath(path: string, suffix: string) {
  const match = /^\/api\/persona-workspace\/([^/]+)\/team-workspace$/.exec(path);
  if (!match || !suffix.startsWith("/")) throw Error("PERSONA_WORKSPACE_PATH_INVALID");
  return workspaceApiPath(match[1]).replace(/\/team-workspace$/, suffix);
}

export function parseTeamSubmission(input: unknown, document: DesignerTeam) {
  const value = z.object({
    actionId: z.number().int().positive(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    document: z.unknown(),
    activated: z.literal(false),
  }).strict().parse(input);
  const saved = validateDesignerTeam(value.document);
  if (JSON.stringify(saved) !== JSON.stringify(validateDesignerTeam(document)))
    throw Error("PERSONA_WORKSPACE_WRITE_MISMATCH");
  return { ...value, document: saved };
}
export function parseWorkspaceContext(input: unknown, project: string) {
  const value = z
    .object({
      project: z
        .object({ id: projectSchema, label: z.string().min(1).max(200) })
        .strict(),
      template: z.unknown(),
      mode: z.literal("mock"),
      providerConnected: z.literal(false),
      workspaceIsApproval: z.literal(false),
    })
    .strict()
    .parse(input);
  if (value.project.id !== project)
    throw Error("PERSONA_WORKSPACE_PROJECT_MISMATCH");
  return { ...value, template: validateDesignerTeam(value.template) };
}
export function validateWorkspaceValue(input: unknown): WorkspaceValue {
  const parsed = z
    .object({ document: z.unknown(), layout: layoutSchema })
    .strict()
    .parse(input);
  const document = validateDesignerTeam(parsed.document);
  const keys = new Set(document.members.map((member) => member.key));
  const positioned = new Set<string>();
  for (const item of parsed.layout.positions) {
    if (!keys.has(item.key) || positioned.has(item.key))
      throw Error("PERSONA_WORKSPACE_LAYOUT_INVALID");
    positioned.add(item.key);
  }
  if (
    parsed.layout.selectedKey !== null &&
    !keys.has(parsed.layout.selectedKey)
  )
    throw Error("PERSONA_WORKSPACE_LAYOUT_INVALID");
  return { document, layout: parsed.layout };
}
export function parseWorkspaceResponse(
  input: unknown,
  writing = false,
): WorkspaceRecord | null {
  const schema = z
    .object({
      workspace: z.unknown(),
      ...(writing
        ? { approved: z.literal(false), activated: z.literal(false) }
        : {}),
    })
    .strict();
  const response = schema.parse(input);
  if (response.workspace === null && !writing) return null;
  const record = z
    .object({
      revision: z.number().int().positive().max(2147483647),
      updatedAt: z.string().min(1),
      document: z.unknown(),
      layout: layoutSchema,
    })
    .strict()
    .parse(response.workspace);
  if (!Number.isFinite(Date.parse(record.updatedAt)))
    throw Error("PERSONA_WORKSPACE_RESPONSE_INVALID");
  return {
    ...validateWorkspaceValue({
      document: record.document,
      layout: record.layout,
    }),
    revision: record.revision,
    updatedAt: record.updatedAt,
  };
}
export function workspaceWriteBody(
  expectedRevision: number,
  value: WorkspaceValue,
) {
  const revision = z
    .number()
    .int()
    .min(0)
    .max(2147483646)
    .parse(expectedRevision);
  const body = { expectedRevision: revision, ...validateWorkspaceValue(value) };
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 30 * 1024)
    throw Error("PERSONA_WORKSPACE_TOO_LARGE");
  return body;
}
export function workspaceSignature(value: WorkspaceValue) {
  const parsed = validateWorkspaceValue({
    document: value.document,
    layout: value.layout,
  });
  return JSON.stringify({
    document: parsed.document,
    layout: {
      ...parsed.layout,
      positions: [...parsed.layout.positions].sort((a, b) =>
        a.key.localeCompare(b.key),
      ),
    },
  });
}
export function workspaceFromTemplate(template: unknown): WorkspaceValue {
  const document = validateDesignerTeam(template);
  return {
    document,
    layout: {
      positions: Object.entries(layoutDesignerTeam(document)).map(
        ([key, point]) => ({ key, ...point }),
      ),
      zoom: 1,
      selectedKey: document.members[0].key,
    },
  };
}

export class WorkspaceRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null,
    readonly ambiguous: boolean,
  ) {
    super(code);
  }
}

/** Module-local client: even reads require the existing issuance CSRF proof.
 * No token in URL, identity headers, auth bypass, or automatic retry. */
export async function workspaceRequest(
  path: string,
  options: {
    body?: unknown;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
    cookie?: string;
  } = {},
) {
  const writing = options.body !== undefined;
  const match = /^\/api\/persona-workspace\/([^/]+)\/(.+)$/.exec(path);
  const operation = match?.[2] ?? "";
  const readAllowed = /^(?:team-workspace|context|teams|team-drafts|proposals|history|workflows|approvals\/[1-9][0-9]*|workflows\/[1-9][0-9]*)$/.test(operation);
  const writeAllowed = /^(?:team-workspace|team-drafts|proposals|team-drafts\/[1-9][0-9]*\/(?:approve|install)|approvals\/[1-9][0-9]*|executions\/[1-9][0-9]*|teams\/[0-9a-f-]{36}\/pause|reconcile\/[0-9a-f-]{36})$/.test(operation);
  if (!(path === "/api/persona-workspace/projects" && !writing)) {
    if (!match || !projectSchema.safeParse(match[1]).success || !(writing ? writeAllowed : readAllowed))
      throw Error("PERSONA_WORKSPACE_PATH_INVALID");
  }
  const cookie =
    options.cookie ?? (typeof document === "undefined" ? "" : document.cookie);
  const tokens = cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("csrf_token="));
  const csrf = tokens.length === 1 ? tokens[0].slice(11) : "";
  if (!/^[a-f0-9]{64}$/i.test(csrf))
    throw new WorkspaceRequestError("PERSONA_SESSION_REQUIRED", 401, false);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(path, {
      method: writing ? (operation === "team-workspace" ? "PUT" : "POST") : "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: options.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
      },
      ...(writing ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new WorkspaceRequestError(
      "PERSONA_WORKSPACE_NETWORK_UNKNOWN",
      null,
      writing,
    );
  }
  let value: unknown;
  try {
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw Error("CONTENT_TYPE");
    value = await response.json();
  } catch {
    throw new WorkspaceRequestError(
      "PERSONA_WORKSPACE_RESPONSE_INVALID",
      response.status,
      writing,
    );
  }
  if (!response.ok) {
    const code =
      typeof value === "object" &&
      value !== null &&
      "error" in value &&
      typeof value.error === "string" &&
      /^PERSONA_[A-Z_]+$/.test(value.error)
        ? value.error
        : "PERSONA_WORKSPACE_REJECTED";
    throw new WorkspaceRequestError(
      code,
      response.status,
      writing && response.status >= 500,
    );
  }
  return value;
}

export type TeamCommandDraft = {
  command: string;
  before: DesignerTeam;
  after: DesignerTeam;
  changes: { key: string; name: string; kind: string; parent: string }[];
};
/** Deliberately a small explicit grammar, not AI or an agent runtime. */
export function draftTeamCommand(
  input: DesignerTeam,
  command: string,
): TeamCommandDraft {
  if (command.length > 500) throw Error("PERSONA_COMMAND_UNSUPPORTED");
  const normalized = command
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/[.!]+$/, "")
    .replace(/\s+/g, " ");
  if (
    ![
      "sosyal medya birimi kur",
      "sosyal medya ekibi kur",
      "sosyal medya birimi kur: araştırma, metin ve görsel-video uzmanları",
      "sosyal medya birimi kur, altına araştırmacı, metin yazarı ve görsel uzmanı ekle",
      "create social media team",
    ].includes(normalized)
  )
    throw Error("PERSONA_COMMAND_UNSUPPORTED");
  const before = validateDesignerTeam(input);
  if (
    before.members.some(
      (member) =>
        member.kind === "department" &&
        /sosyal medya|social media/i.test(member.name),
    )
  )
    throw Error("PERSONA_COMMAND_DEPARTMENT_EXISTS");
  const manager = before.members.find((member) => member.kind === "manager")!;
  let after = addDesignerMember(before, "department", manager.key, {
    name: "Sosyal medya birimi",
    purpose:
      "İnsan incelemesi için sosyal medya taslaklarını koordine et. Yayınlama veya gönderim yapma.",
    output: "İncelenecek içerik taslak paketi",
  });
  const department = after.members.find(
    (member) => !before.members.some((old) => old.key === member.key),
  )!;
  for (const [name, purpose, output] of [
    [
      "Araştırma uzmanı",
      "Yalnız verilen sentetik kaynaktaki bilgileri taslak için düzenle; bilgi uydurma.",
      "Kaynak referanslı araştırma taslağı",
    ],
    [
      "Metin uzmanı",
      "İnsan incelemesine sunulacak metin taslağı hazırla; yayınlama veya gönderim yapma.",
      "İncelenecek metin taslağı",
    ],
    [
      "Görsel/video taslak uzmanı",
      "Ücretli servis kullanmadan görsel/video taslağı için metin brief'i hazırla.",
      "Metin biçiminde görsel/video brief'i",
    ],
  ])
    after = addDesignerMember(after, "specialist", department.key, {
      name,
      purpose,
      output,
    });
  return {
    command: command.trim(),
    before,
    after,
    changes: after.members
      .filter((member) => !before.members.some((old) => old.key === member.key))
      .map((member) => ({
        key: member.key,
        name: member.name,
        kind: member.kind,
        parent: after.members.find((parent) => parent.key === member.parent)!
          .name,
      })),
  };
}
export function applyTeamCommand(
  current: DesignerTeam,
  proposal: TeamCommandDraft,
): DesignerTeam {
  if (
    JSON.stringify(validateDesignerTeam(current)) !==
    JSON.stringify(proposal.before)
  )
    throw Error("PERSONA_COMMAND_STALE");
  const recomputed = draftTeamCommand(current, proposal.command);
  if (JSON.stringify(recomputed) !== JSON.stringify(proposal))
    throw Error("PERSONA_COMMAND_CHANGED");
  return recomputed.after;
}
export function applyWorkspaceCommand(
  value: WorkspaceValue,
  proposal: TeamCommandDraft,
): WorkspaceValue {
  const current = validateWorkspaceValue(value);
  const document = applyTeamCommand(current.document, proposal);
  const defaults = layoutDesignerTeam(document);
  const existing = new Map(
    current.layout.positions.map((item) => [item.key, item]),
  );
  return validateWorkspaceValue({
    document,
    layout: {
      ...current.layout,
      positions: document.members.map(
        (member) =>
          existing.get(member.key) ?? {
            key: member.key,
            ...defaults[member.key],
          },
      ),
    },
  });
}
export function parseWorkspaceRecords(
  teamsInput: unknown,
  workflowsInput: unknown,
) {
  const rows = z
    .array(
      z
        .object({
          id: z.string().uuid(),
          draft_id: z.number().int().positive(),
          status: z.enum(["PAUSED", "MOCK_READY"]),
          document: z.unknown(),
          member_key: key,
          parent_key: key.nullable(),
          persona_id: z.number().int().positive(),
        })
        .strict(),
    )
    .max(1000)
    .parse(teamsInput);
  const teams = new Map<
    string,
    {
      id: string;
      name: string;
      status: string;
      draftId: number;
      members: number;
    }
  >();
  for (const row of rows) {
    const document = validateDesignerTeam(row.document);
    if (
      !document.members.some(
        (member) =>
          member.key === row.member_key && member.parent === row.parent_key,
      )
    )
      throw Error("PERSONA_WORKSPACE_RECORD_INVALID");
    const present = teams.get(row.id);
    if (
      present &&
      (present.name !== document.name ||
        present.draftId !== row.draft_id ||
        present.status !== row.status)
    )
      throw Error("PERSONA_WORKSPACE_RECORD_INVALID");
    teams.set(row.id, {
      id: row.id,
      name: document.name,
      status: row.status,
      draftId: row.draft_id,
      members: (present?.members ?? 0) + 1,
    });
  }
  const workflows = z
    .array(
      z
        .object({
          actionId: z.number().int().positive(),
          name: z.string().min(1).max(200),
          state: z.string().regex(/^[A-Z_]{1,50}$/),
          reviewed: z.boolean(),
        })
        .strict(),
    )
    .max(25)
    .parse(workflowsInput);
  return { teams: [...teams.values()], workflows };
}
