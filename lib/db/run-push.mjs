import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const maxAttempts = 3;

export async function runDbPush() {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[db] drizzle-kit push attempt ${attempt}/${maxAttempts}...`);
      execSync("npx drizzle-kit push --config ./drizzle.config.ts", {
        cwd: __dirname,
        stdio: "inherit",
        timeout: 60000,
        env: { ...process.env },
      });
      console.log("[db] Schema push succeeded.");
      return;
    } catch (err) {
      console.error(`[db] Push attempt ${attempt} failed.`);
      if (attempt < maxAttempts) {
        const delay = attempt * 3000;
        console.log(`[db] Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        console.error("[db] All push attempts failed, starting without migration.");
      }
    }
  }
}
