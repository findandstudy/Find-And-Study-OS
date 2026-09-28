import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { pool } from "@workspace/db";

export type PublicCatalogInvalidation = {
  detailTemplate?: "program" | "university" | "destination" | "city";
  entityType?: "program" | "university" | "destination" | "city" | "catalog" | "article" | "page" | "all";
  entityId?: number;
  locale?: string;
};

type Envelope = { source: string; invalidation: PublicCatalogInvalidation };
const CHANNEL = "public_catalog_invalidation";
const SOURCE = randomUUID();
const emitter = new EventEmitter();
emitter.setMaxListeners(0);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let listenClient: any = null;
let connecting: Promise<void> | null = null;
let shuttingDown = false;
let active = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function valid(value: unknown): value is PublicCatalogInvalidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !["detailTemplate", "entityType", "entityId", "locale"].includes(key))) return false;
  if (record.detailTemplate !== undefined && !["program", "university", "destination", "city"].includes(String(record.detailTemplate))) return false;
  if (record.entityType !== undefined && !["program", "university", "destination", "city", "catalog", "article", "page", "all"].includes(String(record.entityType))) return false;
  if (record.entityId !== undefined && (!Number.isSafeInteger(record.entityId) || Number(record.entityId) <= 0)) return false;
  return record.locale === undefined || (typeof record.locale === "string" && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(record.locale));
}

function scheduleReconnect(): void {
  if (shuttingDown || reconnectTimer || emitter.listenerCount("invalidate") === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect().catch(error => { console.error("[publicCatalogInvalidationBus] reconnect failed", error); scheduleReconnect(); });
  }, 1_000);
}

async function connect(): Promise<void> {
  if (listenClient) return;
  if (connecting) return connecting;
  connecting = (async () => {
    try {
      const client = await pool.connect();
      const onNotification = (message: { channel: string; payload?: string }) => {
        if (message.channel !== CHANNEL || !message.payload) return;
        try {
          const envelope = JSON.parse(message.payload) as Envelope;
          if (envelope.source === SOURCE || typeof envelope.source !== "string" || !valid(envelope.invalidation)) return;
          emitter.emit("invalidate", envelope.invalidation);
        } catch (error) { console.error("[publicCatalogInvalidationBus] invalid payload", error); }
      };
      const onError = (error: Error) => {
        console.error("[publicCatalogInvalidationBus] listener error", error);
        try { client.removeListener("notification", onNotification); client.removeListener("error", onError); client.release(true); } catch { /* best effort */ }
        listenClient = null;
        scheduleReconnect();
      };
      client.on("notification", onNotification);
      client.on("error", onError);
      await client.query(`LISTEN ${CHANNEL}`);
      listenClient = client;
      console.log("[publicCatalogInvalidationBus] LISTEN connection established");
    } finally { connecting = null; }
  })();
  return connecting;
}

export const publicCatalogInvalidationBus = {
  publish(invalidation: PublicCatalogInvalidation): void {
    if (!active || !valid(invalidation)) return;
    const payload = JSON.stringify({ source: SOURCE, invalidation } satisfies Envelope);
    pool.query("SELECT pg_notify($1, $2)", [CHANNEL, payload])
      .catch(error => console.error("[publicCatalogInvalidationBus] publish failed", error));
  },
  subscribe(handler: (invalidation: PublicCatalogInvalidation) => void): () => void {
    shuttingDown = false;
    active = true;
    emitter.on("invalidate", handler);
    void connect().catch(error => { console.error("[publicCatalogInvalidationBus] initial LISTEN failed", error); scheduleReconnect(); });
    return () => emitter.off("invalidate", handler);
  },
  async shutdown(): Promise<void> {
    shuttingDown = true;
    active = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const client = listenClient;
    listenClient = null;
    if (!client) return;
    try { await client.query(`UNLISTEN ${CHANNEL}`); client.release(); }
    catch { try { client.release(true); } catch { /* best effort */ } }
  },
};
