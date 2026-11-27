// Local API launcher: avoids production startup seeders and background workers.
import { workPipelineTenant } from "../artifacts/api-server/src/lib/workPipelines";
import { createServer } from "node:http";
if (!workPipelineTenant())
  throw new Error("Explicit local work-pipelines configuration required");
const { default: app } = await import("../artifacts/api-server/src/app");
createServer((req, res) => {
  // Local HTTP/1 has six browser connections per origin. Embedded tabs can all
  // report visible, including stale clients predating the visibility fix.
  // End only local SSE leases so queued navigation/module requests can proceed.
  if (
    req.method === "GET" &&
    [
      "/api/inbox/events",
      "/api/notifications/events",
      "/api/persons/feed/stream",
    ].includes((req.url ?? "").split("?")[0])
  ) {
    const timer = setTimeout(() => res.end(), 15_000);
    res.once("close", () => clearTimeout(timer));
  }
  app(req, res);
}).listen(8080, "127.0.0.1", () =>
  console.log(
    "Local API: http://127.0.0.1:8080 (local pipeline reminders only; no external delivery or production startup seeders)",
  ),
);

// Only the isolated module reminder tick; all external delivery stays off.
const { runWorkReminders } =
  await import("../artifacts/api-server/src/lib/workPipelineActivity");
let ticking = false;
const reminderTick = async () => {
  if (ticking) return;
  ticking = true;
  try {
    await runWorkReminders();
  } catch {
    console.error("Local pipeline reminder tick failed");
  } finally {
    ticking = false;
  }
};
void reminderTick();
setInterval(() => void reminderTick(), 30_000).unref();
