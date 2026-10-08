import { z } from "zod";

// Browser-only design state. This is not a persisted team, permission or executor.
// The shape and hierarchy deliberately match personaTeamDraft's existing contract.
export const DESIGNER_MAX_MEMBERS = 20;
export const DESIGNER_MAX_POSITION = 3800;
export const DESIGNER_NODE_WIDTH = 200;
export const DESIGNER_NODE_HEIGHT = 100;
export const DESIGNER_COLUMN_GAP = 56;
export const DESIGNER_LEVEL_STEP = 160;
export const DESIGNER_KINDS = ["manager", "department", "specialist"] as const;
export type DesignerKind = (typeof DESIGNER_KINDS)[number];

const keySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
const editableSchema = z.object({
  name: z.string().trim().min(1).max(100),
  purpose: z.string().trim().min(1).max(2000),
  output: z.string().trim().min(1).max(2000),
  capMicros: z.number().int().positive().max(1000000),
  timeoutSeconds: z.number().int().min(1).max(30),
}).strict();
const memberSchema = editableSchema.extend({
  key: keySchema,
  kind: z.enum(DESIGNER_KINDS),
  parent: keySchema.nullable(),
  provider: z.literal("mock"),
  model: z.literal("mock-fixture"),
  tools: z.array(z.literal("mock_draft")).length(1),
  dataScopes: z.array(z.literal("persona_mock_context")).length(1),
  concurrency: z.literal(1),
  humanApproval: z.literal(true),
}).strict();
const teamSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(100),
  members: z.array(memberSchema).min(1).max(DESIGNER_MAX_MEMBERS),
}).strict();

export type DesignerMember = z.infer<typeof memberSchema>;
export type DesignerTeam = z.infer<typeof teamSchema>;
export type DesignerMemberPatch = Partial<z.infer<typeof editableSchema>>;
export type DesignerPosition = { x: number; y: number };
export type DesignerPositions = Record<string, DesignerPosition>;

/** Clone, fully validate and return stable parent-before-child order. */
export function validateDesignerTeam(input: unknown): DesignerTeam {
  const team = teamSchema.parse(input);
  const members = new Map(team.members.map((member) => [member.key, member]));
  if (members.size !== team.members.length) throw Error("PERSONA_TEAM_DUPLICATE");
  const roots = team.members.filter((member) => member.parent === null);
  if (roots.length !== 1 || roots[0].kind !== "manager") {
    throw Error("PERSONA_TEAM_ROOT_INVALID");
  }
  for (const member of team.members) {
    if (member.parent === null) continue;
    const parent = members.get(member.parent);
    if (!parent || parent.kind === "specialist" || member.kind === "manager") {
      throw Error("PERSONA_TEAM_PARENT_INVALID");
    }
  }
  const ordered: DesignerMember[] = [];
  const seen = new Set<string>();
  function visit(key: string) {
    if (seen.has(key)) throw Error("PERSONA_TEAM_CYCLE");
    seen.add(key);
    ordered.push(members.get(key)!);
    for (const member of team.members) if (member.parent === key) visit(member.key);
  }
  visit(roots[0].key);
  if (ordered.length !== team.members.length) throw Error("PERSONA_TEAM_CYCLE_OR_DISCONNECTED");
  return { ...team, members: ordered };
}

function mockMember(key: string, name: string, kind: DesignerKind, parent: string | null): DesignerMember {
  return {
    key, name, kind, parent,
    purpose: "Yalnız sentetik yerel taslak hazırlama",
    output: "İnsan incelemesine sunulan taslak",
    provider: "mock", model: "mock-fixture", tools: ["mock_draft"],
    dataScopes: ["persona_mock_context"], capMicros: 100000,
    timeoutSeconds: 30, concurrency: 1, humanApproval: true,
  };
}

export function createDesignerTeam(template: unknown): DesignerTeam {
  // No client-generated initial fallback: the caller must receive its template
  // through the existing authenticated preview gate before creating local state.
  return validateDesignerTeam(template);
}

function requireMember(team: DesignerTeam, key: string): DesignerMember {
  const member = team.members.find((item) => item.key === key);
  if (!member) throw Error("PERSONA_TEAM_MEMBER_NOT_FOUND");
  return member;
}

export function nextDesignerMemberKey(team: DesignerTeam, kind: "department" | "specialist"): string {
  const value = validateDesignerTeam(team);
  if (kind !== "department" && kind !== "specialist") throw Error("PERSONA_TEAM_KIND_INVALID");
  const existing = new Set(value.members.map((member) => member.key));
  for (let index = 1; index <= DESIGNER_MAX_MEMBERS; index++) {
    const key = `${kind}_${index}`;
    if (!existing.has(key)) return key;
  }
  throw Error("PERSONA_TEAM_LIMIT");
}

export function addDesignerMember(
  input: DesignerTeam,
  kind: "department" | "specialist",
  parent: string,
  overrides: DesignerMemberPatch = {},
): DesignerTeam {
  const team = validateDesignerTeam(input);
  if (team.members.length >= DESIGNER_MAX_MEMBERS) throw Error("PERSONA_TEAM_LIMIT");
  const key = nextDesignerMemberKey(team, kind);
  const changes = editableSchema.partial().parse(overrides);
  team.members.push({
    ...mockMember(key, kind === "department" ? "Yeni birim" : "Yeni uzman", kind, parent),
    ...changes,
  });
  return validateDesignerTeam(team);
}

export function updateDesignerMember(input: DesignerTeam, key: string, patch: DesignerMemberPatch): DesignerTeam {
  const team = validateDesignerTeam(input);
  const member = requireMember(team, key);
  Object.assign(member, editableSchema.partial().parse(patch));
  return validateDesignerTeam(team);
}

export function renameDesignerTeam(input: DesignerTeam, name: string): DesignerTeam {
  return validateDesignerTeam({ ...validateDesignerTeam(input), name });
}

export function reparentDesignerMember(input: DesignerTeam, key: string, parent: string): DesignerTeam {
  const team = validateDesignerTeam(input);
  const member = requireMember(team, key);
  if (member.kind === "manager" || key === parent) throw Error("PERSONA_TEAM_PARENT_INVALID");
  member.parent = parent;
  return validateDesignerTeam(team);
}

/** Includes the selected member; suitable for showing an explicit delete impact. */
export function getDesignerDescendantKeys(input: DesignerTeam, key: string): string[] {
  const team = validateDesignerTeam(input);
  requireMember(team, key);
  const keys = new Set([key]);
  for (const member of team.members) {
    if (member.parent !== null && keys.has(member.parent)) keys.add(member.key);
  }
  return [...keys];
}

export function getDesignerParentOptions(input: DesignerTeam, key: string): DesignerMember[] {
  const team = validateDesignerTeam(input);
  if (requireMember(team, key).kind === "manager") return [];
  const descendants = new Set(getDesignerDescendantKeys(team, key));
  return team.members.filter((member) => member.kind !== "specialist" && !descendants.has(member.key));
}

export function removeDesignerMember(
  input: DesignerTeam,
  key: string,
  options: { mode: "subtree" | "promote" } = { mode: "promote" },
): DesignerTeam {
  const team = validateDesignerTeam(input);
  const member = requireMember(team, key);
  if (member.parent === null) throw Error("PERSONA_TEAM_ROOT_DELETE_DENIED");
  if (options.mode !== "subtree" && options.mode !== "promote") throw Error("PERSONA_TEAM_DELETE_MODE_INVALID");
  if (options.mode === "subtree") {
    const removed = new Set(getDesignerDescendantKeys(team, key));
    team.members = team.members.filter((item) => !removed.has(item.key));
  } else {
    team.members = team.members.filter((item) => item.key !== key).map((item) => (
      item.parent === key ? { ...item, parent: member.parent } : item
    ));
  }
  return validateDesignerTeam(team);
}

/** Center parents over their descendant span; hierarchy never changes with layout. */
export function layoutDesignerTeam(input: DesignerTeam): DesignerPositions {
  const team = validateDesignerTeam(input);
  const columnStep = DESIGNER_NODE_WIDTH + DESIGNER_COLUMN_GAP;
  const columns = Math.floor((DESIGNER_MAX_POSITION - 32 - DESIGNER_NODE_WIDTH) / columnStep) + 1;
  const children = new Map<string, DesignerMember[]>();
  for (const member of team.members) {
    if (member.parent === null) continue;
    const siblings = children.get(member.parent) ?? [];
    siblings.push(member);
    children.set(member.parent, siblings);
  }
  const positions: DesignerPositions = {};
  const leafCount = team.members.filter((member) => !children.has(member.key)).length;
  if (leafCount <= columns) {
    let nextLeaf = 0;
    function place(key: string, depth: number): { left: number; right: number } {
      const members = children.get(key) ?? [];
      let span: { left: number; right: number };
      if (members.length === 0) {
        const column = nextLeaf++;
        span = { left: column, right: column };
      } else {
        const childSpans = members.map((member) => place(member.key, depth + 1));
        span = { left: childSpans[0].left, right: childSpans[childSpans.length - 1].right };
      }
      positions[key] = {
        x: 32 + ((span.left + span.right) / 2) * columnStep,
        y: 32 + depth * DESIGNER_LEVEL_STEP,
      };
      return span;
    }
    place(team.members[0].key, 0);
    return positions;
  }

  // A very broad team cannot fit a single leaf row within the existing canvas.
  // Center each wrapped level and reserve full row heights to avoid overlap.
  const depths = new Map<string, number>();
  const levels = new Map<number, DesignerMember[]>();
  for (const member of team.members) {
    const depth = member.parent === null ? 0 : depths.get(member.parent)! + 1;
    depths.set(member.key, depth);
    const level = levels.get(depth) ?? [];
    level.push(member);
    levels.set(depth, level);
  }
  const widestRow = Math.min(columns, Math.max(...[...levels.values()].map((members) => members.length)));
  let top = 32;
  for (const [, members] of [...levels].sort(([a], [b]) => a - b)) {
    members.forEach((member, column) => {
      const row = Math.floor(column / columns);
      const rowSize = Math.min(columns, members.length - row * columns);
      positions[member.key] = {
        x: 32 + ((widestRow - rowSize) / 2 + column % columns) * columnStep,
        y: top + row * DESIGNER_LEVEL_STEP,
      };
    });
    top += Math.ceil(members.length / columns) * DESIGNER_LEVEL_STEP;
  }
  return positions;
}

const positionSchema = z.object({
  x: z.number().finite().min(0).max(DESIGNER_MAX_POSITION),
  y: z.number().finite().min(0).max(DESIGNER_MAX_POSITION),
}).strict();

export function clampDesignerPosition(position: DesignerPosition): DesignerPosition {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw Error("PERSONA_TEAM_POSITION_INVALID");
  return {
    x: Math.max(0, Math.min(DESIGNER_MAX_POSITION, position.x)),
    y: Math.max(0, Math.min(DESIGNER_MAX_POSITION, position.y)),
  };
}

export function setDesignerPosition(positions: DesignerPositions, key: string, position: DesignerPosition): DesignerPositions {
  keySchema.parse(key);
  if (Object.keys(positions).length > DESIGNER_MAX_MEMBERS) throw Error("PERSONA_TEAM_POSITION_LIMIT");
  const next: DesignerPositions = {};
  for (const [itemKey, itemPosition] of Object.entries(positions)) {
    keySchema.parse(itemKey);
    next[itemKey] = positionSchema.parse(itemPosition);
  }
  next[key] = positionSchema.parse(position);
  if (Object.keys(next).length > DESIGNER_MAX_MEMBERS) throw Error("PERSONA_TEAM_POSITION_LIMIT");
  return next;
}
