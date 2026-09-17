import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./authoring",
  workers: 1,
  timeout: 45_000,
  reporter: "line",
  outputDir: "../../../../outputs/page-authoring-browser",
  use: {
    baseURL: "http://127.0.0.1:25198",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
    screenshot: "only-on-failure",
  },
});
