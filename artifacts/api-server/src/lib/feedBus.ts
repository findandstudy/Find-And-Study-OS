import { EventEmitter } from "events";

export interface FeedBusEvent {
  personKeys: string[];
  action: "note_added" | "note_deleted" | "followup_added" | "followup_updated";
  itemId: number;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export const feedBus = {
  publish(event: FeedBusEvent): void {
    emitter.emit("feed", event);
  },
  subscribe(handler: (event: FeedBusEvent) => void): () => void {
    emitter.on("feed", handler);
    return () => emitter.off("feed", handler);
  },
};

export function personKeys(leadId: number | null, studentId: number | null): string[] {
  const keys: string[] = [];
  if (leadId) keys.push(`lead_${leadId}`);
  if (studentId) keys.push(`student_${studentId}`);
  return keys;
}
