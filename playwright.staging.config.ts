import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

const EXACT_STAGING_ORIGIN = "https://staging.findandstudy.com";

function resolveStagingOrigin(): string {
  const raw = (process.env.PLAYWRIGHT_BASE_URL ?? "").replace(/\/$/, "");
  if (raw !== EXACT_STAGING_ORIGIN) {
    throw new Error(
      `[staging-rbac-uat] PLAYWRIGHT_BASE_URL must be exact ${EXACT_STAGING_ORIGIN}`,
    );
  }
  if ((process.env.RBAC_E2E_PASSWORD ?? "").length < 20) {
    throw new Error("[staging-rbac-uat] RBAC_E2E_PASSWORD is required");
  }
  if (process.env.ALLOW_STAGING_RBAC_UAT !== "true") {
    throw new Error(
      "[staging-rbac-uat] ALLOW_STAGING_RBAC_UAT=true is required",
    );
  }
  if (process.env.ALLOW_LIVE_INTEGRATIONS !== "false") {
    throw new Error(
      "[staging-rbac-uat] ALLOW_LIVE_INTEGRATIONS=false is required",
    );
  }
  return raw;
}

function findChromiumExecutable(): string | undefined {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (explicit && existsSync(explicit)) return explicit;

  const candidates = [
    process.env.PROGRAMFILES &&
      path.join(
        process.env.PROGRAMFILES,
        "Google/Chrome/Application/chrome.exe",
      ),
    process.env["PROGRAMFILES(X86)"] &&
      path.join(
        process.env["PROGRAMFILES(X86)"],
        "Google/Chrome/Application/chrome.exe",
      ),
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        "Google/Chrome/Application/chrome.exe",
      ),
    process.env.PROGRAMFILES &&
      path.join(
        process.env.PROGRAMFILES,
        "Microsoft/Edge/Application/msedge.exe",
      ),
    process.env["PROGRAMFILES(X86)"] &&
      path.join(
        process.env["PROGRAMFILES(X86)"],
        "Microsoft/Edge/Application/msedge.exe",
      ),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate));
}

const baseURL = resolveStagingOrigin();
const executablePath = findChromiumExecutable();

export default defineConfig({
  testDir: "./artifacts/edcons/tests/e2e",
  testMatch: /rbac-functional\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["line"]],
  use: {
    baseURL,
    locale: "en-US",
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: "staging-chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath
          ? { launchOptions: { executablePath, args: ["--lang=en-US"] } }
          : {}),
      },
    },
  ],
});
