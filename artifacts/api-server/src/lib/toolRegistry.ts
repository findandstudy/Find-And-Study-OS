import { db, websiteBlogPostsTable } from "@workspace/db";
import { dispatchNotification } from "./notificationDispatcher";

export type ToolInput = {
  personaId: number;
  personaName: string;
  runId: number;
  llmOutput: string;
  adminUserIds: number[];
};

export type ToolResult = {
  ok: boolean;
  detail: string;
  data?: unknown;
};

export type ToolDef = {
  key: string;
  label: string;
  description: string;
  sideEffect: boolean;
  run: (input: ToolInput) => Promise<ToolResult>;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

const notificationTool: ToolDef = {
  key: "notification",
  label: "In-app notification",
  description: "Posts the LLM result as an in-app notification to admins.",
  sideEffect: false,
  async run({ personaName, llmOutput, adminUserIds }) {
    if (adminUserIds.length === 0) {
      return { ok: false, detail: "No admin recipients found" };
    }
    await dispatchNotification({
      event: "ai_persona.advisor_output",
      title: `AI Persona: ${personaName}`,
      body: llmOutput.slice(0, 500),
      recipientUserIds: adminUserIds,
      data: { source: "ai_persona", persona: personaName },
    });
    return { ok: true, detail: `Notification sent to ${adminUserIds.length} admin(s)` };
  },
};

const internalMsgTool: ToolDef = {
  key: "internal_msg",
  label: "Internal message (digest)",
  description: "Dispatches the result as an internal admin digest notification.",
  sideEffect: false,
  async run({ personaName, llmOutput, adminUserIds }) {
    if (adminUserIds.length === 0) {
      return { ok: false, detail: "No admin recipients found" };
    }
    await dispatchNotification({
      event: "ai_persona.internal_digest",
      title: `Digest from ${personaName}`,
      body: llmOutput.slice(0, 800),
      recipientUserIds: adminUserIds,
      data: { source: "ai_persona_digest", persona: personaName },
    });
    return { ok: true, detail: `Internal digest delivered to ${adminUserIds.length} admin(s)` };
  },
};

const blogDraftTool: ToolDef = {
  key: "blog_draft",
  label: "Blog draft (no publish)",
  description: "Inserts the LLM output as a draft blog post — never publishes.",
  sideEffect: false,
  async run({ personaName, llmOutput }) {
    const firstLine = llmOutput.split("\n").find((l) => l.trim().length > 0) || "AI draft";
    const title = firstLine.replace(/^#+\s*/, "").slice(0, 180) || `Draft by ${personaName}`;
    const baseSlug = slugify(title) || `ai-draft-${Date.now()}`;
    const slug = `${baseSlug}-${Date.now().toString(36)}`;
    const [row] = await db
      .insert(websiteBlogPostsTable)
      .values({
        slug,
        title,
        content: llmOutput,
        status: "draft",
        locale: "en",
      })
      .returning({ id: websiteBlogPostsTable.id, slug: websiteBlogPostsTable.slug });
    return { ok: true, detail: `Draft blog post created (#${row?.id}, ${row?.slug})`, data: row };
  },
};

const sendEmailTool: ToolDef = {
  key: "send_email",
  label: "Send email",
  description: "Sends an email through the configured SMTP integration.",
  sideEffect: true,
  async run() {
    return { ok: false, detail: "send_email queued for operator approval (Phase 2)" };
  },
};

const publishBlogTool: ToolDef = {
  key: "publish_blog",
  label: "Publish blog post",
  description: "Publishes a blog post to the public website.",
  sideEffect: true,
  async run() {
    return { ok: false, detail: "publish_blog queued for operator approval (Phase 2)" };
  },
};

export const TOOL_REGISTRY: Record<string, ToolDef> = {
  notification: notificationTool,
  internal_msg: internalMsgTool,
  blog_draft: blogDraftTool,
  send_email: sendEmailTool,
  publish_blog: publishBlogTool,
};

export function listTools() {
  return Object.values(TOOL_REGISTRY).map((t) => ({
    key: t.key,
    label: t.label,
    description: t.description,
    sideEffect: t.sideEffect,
  }));
}
