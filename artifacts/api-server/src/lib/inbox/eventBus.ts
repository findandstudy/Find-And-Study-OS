import { EventEmitter } from "events";
import { pool } from "@workspace/db";

export type InboxBusEvent =
  | {
      type: "message";
      conversationId: number;
      channel: string;
      assignedToId: number | null;
      unmatched: boolean;
      direction: "inbound" | "outbound";
    }
  | {
      type: "assigned";
      conversationId: number;
      assignedToId: number | null;
      previousAssignedToId: number | null;
      actorUserId: number | null;
    }
  | {
      type: "read_state";
      conversationId: number;
      actorUserId: number;
      unread: boolean;
      unreadCount: number;
    };

const CHANNEL = "inbox_events";
const RECONNECT_DELAY_MS = 1000;

const localEmitter = new EventEmitter();
localEmitter.setMaxListeners(0);

let listenClient: any = null;
let connecting: Promise<void> | null = null;
let isShuttingDown = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReconnect(): void {
  if (isShuttingDown || reconnectTimer || localEmitter.listenerCount("event") === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectListenClient().catch((err) => {
      console.error("[inboxBus] reconnect failed, will retry", err);
      scheduleReconnect();
    });
  }, RECONNECT_DELAY_MS);
}

async function connectListenClient(): Promise<void> {
  if (listenClient) return;
  if (connecting) return connecting;
  connecting = (async (): Promise<void> => {
    try {
      const client = await pool.connect();
      const handleNotification = (msg: {
        channel: string;
        payload?: string;
      }) => {
        if (msg.channel !== CHANNEL || !msg.payload) return;
        try {
          const event = JSON.parse(msg.payload) as InboxBusEvent;
          localEmitter.emit("event", event);
        } catch (err) {
          console.error("[inboxBus] failed to parse notification", err);
        }
      };
      const handleError = (err: Error) => {
        console.error("[inboxBus] LISTEN client error, reconnecting", err);
        try {
          client.removeListener("notification", handleNotification);
          client.removeListener("error", handleError);
          client.release(true);
        } catch {
          // ignore
        }
        listenClient = null;
        scheduleReconnect();
      };
      client.on("notification", handleNotification);
      client.on("error", handleError);
      await client.query(`LISTEN ${CHANNEL}`);
      listenClient = client;
      return;
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

export const inboxBus = {
  subscribe(handler: (event: InboxBusEvent) => void): () => void {
    isShuttingDown = false;
    localEmitter.on("event", handler);
    void connectListenClient().catch((err) => {
      console.error("[inboxBus] initial LISTEN failed, will retry", err);
      scheduleReconnect();
    });
    return () => {
      localEmitter.off("event", handler);
    };
  },
  publish(event: InboxBusEvent): void {
    const payload = JSON.stringify(event);
    pool
      .query("SELECT pg_notify($1, $2)", [CHANNEL, payload])
      .catch((err: unknown) => {
        console.error("[inboxBus] publish failed", err);
      });
  },
  async shutdown(): Promise<void> {
    isShuttingDown = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const client = listenClient;
    listenClient = null;
    if (!client) return;
    try {
      await client.query(`UNLISTEN ${CHANNEL}`);
      client.release();
    } catch {
      try { client.release(true); } catch { /* ignore */ }
    }
  },
};
