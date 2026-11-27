import { workPipelineTenant } from "./workPipelines";
import { runWorkReminders } from "./workPipelineActivity";

/** In-app notifications only. No provider send, CRM job or external scheduler. */
export function startWorkPipelineReminderWorker(): (() => Promise<void>) | null {
  if (!workPipelineTenant()) return null;
  let stopped = false;
  let pending: Promise<unknown> | null = null;
  const tick = () => {
    if (stopped || pending) return;
    pending = runWorkReminders().catch(() => {
      console.error("[work-pipelines] In-app reminder tick failed");
    }).finally(() => { pending = null; });
  };
  const timer = setInterval(tick, 30_000);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await pending; };
}
