import { defineConfig, devices } from "@playwright/test";
import { execSync } from "child_process";

function findSystemChromium(): string | undefined {
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (envPath) return envPath;
  try {
    const p = execSync("which chromium", { stdio: ["pipe", "pipe", "pipe"] })
      .toString()
      .trim();
    return p || undefined;
  } catch {
    return undefined;
  }
}

const systemChromium = findSystemChromium();

export default defineConfig({
  testDir: "./artifacts/edcons/tests/e2e",

  globalSetup: "./playwright-global-setup.ts",
  globalTeardown: "./playwright-global-teardown.ts",

  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [["line"], ["junit", { outputFile: "test-results/e2e-results.xml" }]],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:25197",
    locale: "en-US",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ...(systemChromium
      ? {
          launchOptions: {
            executablePath: systemChromium,
            args: ["--lang=en-US"],
          },
        }
      : {}),
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],

  webServer: [
    {
      command: "pnpm --filter @workspace/api-server run dev",
      port: 8080,
      timeout: 60_000,
      reuseExistingServer: true,
      env: {
        PORT: "8080",
        NODE_ENV: "development",
      },
    },
    {
      command: "pnpm --filter @workspace/edcons run dev",
      port: 25197,
      timeout: 60_000,
      reuseExistingServer: true,
      env: {
        PORT: "25197",
        NODE_ENV: "development",
        BASE_PATH: "/",
      },
    },
  ],
});
