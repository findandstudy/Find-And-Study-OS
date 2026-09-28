import { EventEmitter } from "node:events";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";

export type FacetCacheNamespace = "applications" | "leads" | "students";

const CHANNEL = "facet_cache_invalidation";
const namespaces = new Set<FacetCacheNamespace>(["applications", "leads", "students"]);
const emitter = new EventEmitter();
emitter.setMaxListeners(0);
let listenClient: PoolClient | null = null;
let connecting: Promise<void> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;

function validNamespace(value: unknown): value is FacetCacheNamespace {
  return typeof value === "string" && namespaces.has(value as FacetCacheNamespace);
}

function scheduleReconnect(): void {
  if (shuttingDown || reconnectTimer || emitter.listenerCount("invalidate") === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect().catch((error) => {
      console.error("[facetCacheInvalidationBus] reconnect failed", error);
      scheduleReconnect();
    });
  }, 1_000);
  reconnectTimer.unref?.();
}

async function connect(): Promise<void> {
  if (listenClient || connecting) return connecting ?? undefined;
  connecting = (async () => {
    try {
      const client = await pool.connect();
      const onNotification = (message: { channel: string; payload?: string }) => {
        if (message.channel !== CHANNEL || !message.payload) return;
        try {
          const parsed = JSON.parse(message.payload) as { namespace?: unknown };
          if (validNamespace(parsed.namespace)) emitter.emit("invalidate", parsed.namespace);
        } catch (error) {
          console.error("[facetCacheInvalidationBus] invalid payload", error);
        }
      };
      const onError = (error: Error) => {
        console.error("[facetCacheInvalidationBus] listener error", error);
        try {
          client.removeListener("notification", onNotification);
          client.removeListener("error", onError);
          client.release(true);
        } catch { /* best effort */ }
        listenClient = null;
        scheduleReconnect();
      };
      client.on("notification", onNotification);
      client.on("error", onError);
      try {
        await client.query(`LISTEN ${CHANNEL}`);
      } catch (error) {
        client.removeListener("notification", onNotification);
        client.removeListener("error", onError);
        client.release(true);
        throw error;
      }
      listenClient = client;
      console.log("[facetCacheInvalidationBus] LISTEN connection established");
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

export const facetCacheInvalidationBus = {
  subscribe(handler: (namespace: FacetCacheNamespace) => void): () => void {
    shuttingDown = false;
    emitter.on("invalidate", handler);
    void connect().catch((error) => {
      console.error("[facetCacheInvalidationBus] initial LISTEN failed", error);
      scheduleReconnect();
    });
    return () => emitter.off("invalidate", handler);
  },
  async shutdown(): Promise<void> {
    shuttingDown = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const client = listenClient;
    listenClient = null;
    if (!client) return;
    try {
      await client.query(`UNLISTEN ${CHANNEL}`);
      client.release();
    } catch {
      try { client.release(true); } catch { /* best effort */ }
    }
  },
};
