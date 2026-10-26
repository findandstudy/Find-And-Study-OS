import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { workspaceRequest, workspaceTaskPath } from "@/lib/personaTeamWorkspace";
// Reuse the existing audited mock-task client; the server rechecks each request.
// @ts-expect-error The existing browser module is plain JavaScript.
import { initializeTeamTasks } from "../../../../api-server/src/lib/persona-team-tasks.client.js";
import "./team-workspace-tasks.css";

export default function TeamWorkspaceTasks({ path, disabled, refreshVersion }: {
  path: string;
  disabled: boolean;
  refreshVersion: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    element.replaceChildren();
    if (disabled) return;
    const requests = new Set<AbortController>();
    let disposed = false;
    const panel = initializeTeamTasks({
      container: element,
      api: async (suffix: string, body?: unknown) => {
        if (disposed) throw Error("PERSONA_SESSION_REQUIRED");
        const controller = new AbortController();
        requests.add(controller);
        const timeout = window.setTimeout(() => controller.abort(), 12000);
        try {
          return await workspaceRequest(workspaceTaskPath(path, suffix), {
            ...(body === undefined ? {} : { body }), signal: controller.signal,
          });
        } finally {
          requests.delete(controller);
          window.clearTimeout(timeout);
        }
      },
    });
    void panel.refresh();
    return () => {
      disposed = true;
      panel.destroy();
      for (const request of requests) request.abort();
      element.replaceChildren();
    };
  }, [path, disabled, refreshVersion]);
  return <Card className="p-4" data-testid="workspace-tasks">
    <div ref={container} className="team-workspace-tasks" />
  </Card>;
}
