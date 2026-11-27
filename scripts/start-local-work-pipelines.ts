// Local API launcher: avoids production startup seeders and background workers.
import { workPipelineTenant } from "../artifacts/api-server/src/lib/workPipelines";
if (!workPipelineTenant())
  throw new Error("Explicit local work-pipelines configuration required");
const { default: app } = await import("../artifacts/api-server/src/app");
app.listen(8080, "127.0.0.1", () =>
  console.log(
    "Local API: http://127.0.0.1:8080 (no workers, no production startup seeders)",
  ),
);
