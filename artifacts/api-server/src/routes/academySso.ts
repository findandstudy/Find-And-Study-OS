import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { requireAuth } from "../lib/auth";
import { db, agentsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

async function resolveCompanyName(userId: number, role: string): Promise<string | null> {
  try {
    if (role === "agent_staff") {
      const [staffUser] = await db
        .select({ managingAgentId: usersTable.managingAgentId })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      if (!staffUser?.managingAgentId) return null;
      const [agent] = await db
        .select({ companyName: agentsTable.companyName })
        .from(agentsTable)
        .where(eq(agentsTable.id, staffUser.managingAgentId));
      return agent?.companyName ?? null;
    }
    const [agent] = await db
      .select({ companyName: agentsTable.companyName })
      .from(agentsTable)
      .where(eq(agentsTable.userId, userId));
    return agent?.companyName ?? null;
  } catch {
    return null;
  }
}

function signHs256(payload: Record<string, unknown>, secret: string): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, exp: now + 120, jti: crypto.randomUUID(), ...payload };
  const data = b64({ alg: "HS256", typ: "JWT" }) + "." + b64(body);
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return data + "." + sig;
}

router.get("/academy-sso", requireAuth, async (req: Request, res: Response) => {
  const secret = process.env.SSO_SHARED_SECRET;
  if (!secret) {
    res.status(500).send("SSO not configured");
    return;
  }
  const u = req.user!;
  const company = await resolveCompanyName(u.id, u.role);
  const token = signHs256(
    {
      email: u.email,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
      company: company,
      phone: (u as any).phone ?? null,
      sub: String(u.id),
    },
    secret,
  );
  res.redirect(
    "https://academy.findandstudy.com/api/sso?token=" + encodeURIComponent(token),
  );
});

export default router;
