import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./staging-public", workers: 1, timeout: 45_000, reporter: "line",
  outputDir: "../../../../outputs/staging-public-20260917",
  use: { baseURL: "https://staging.findandstudy.com", launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }, screenshot: "only-on-failure" },
});
