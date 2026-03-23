import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const maxAttempts = 3;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    console.log(`drizzle-kit push attempt ${attempt}/${maxAttempts}...`);
    execSync("drizzle-kit push --config ./drizzle.config.ts", {
      cwd: __dirname,
      stdio: "inherit",
      timeout: 60000,
    });
    console.log("drizzle-kit push succeeded.");
    process.exit(0);
  } catch (err) {
    console.error(`drizzle-kit push attempt ${attempt} failed.`);
    if (attempt < maxAttempts) {
      const delay = attempt * 3000;
      console.log(`Retrying in ${delay / 1000}s...`);
      await new Promise((r) => setTimeout(r, delay));
    } else {
      console.error("All drizzle-kit push attempts failed.");
      process.exit(1);
    }
  }
}
