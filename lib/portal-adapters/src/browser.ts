import { chromium } from "playwright-core";
import type { Page } from "playwright-core";
import type { AdapterSession } from "./types.js";

// ---------------------------------------------------------------------------
// Logger — console-based; swap to a structured logger in production
// ---------------------------------------------------------------------------
export const logger = {
  info:  (...args: unknown[]): void => console.info( "[portal-adapters]", ...args),
  warn:  (...args: unknown[]): void => console.warn( "[portal-adapters]", ...args),
  error: (...args: unknown[]): void => console.error("[portal-adapters]", ...args),
};

// ---------------------------------------------------------------------------
// Launch options
// ---------------------------------------------------------------------------
export interface LaunchOpts {
  headless?: boolean;
  /**
   * Absolute path to a Playwright storageState JSON file.
   * When provided the browser context is initialised with the saved cookies
   * and localStorage.  When omitted a fresh (unauthenticated) context is used.
   * The path is ALWAYS supplied by the caller — never hard-coded inside an adapter.
   */
  storagePath?: string;
}

// ---------------------------------------------------------------------------
// launchPortal — open a browser and return an AdapterSession
// ---------------------------------------------------------------------------
export async function launchPortal(opts: LaunchOpts = {}): Promise<AdapterSession> {
  const { headless = true, storagePath } = opts;

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext(
    storagePath ? { storageState: storagePath } : {},
  );
  const page = await context.newPage();

  return {
    page,
    async close(): Promise<void> {
      await browser.close();
    },
  };
}

// ---------------------------------------------------------------------------
// saveState — persist cookies / localStorage for later reuse
// ---------------------------------------------------------------------------
export async function saveState(page: Page, path: string): Promise<void> {
  await page.context().storageState({ path });
  logger.info(`Storage state saved → ${path}`);
}

// ---------------------------------------------------------------------------
// closePortal — convenience wrapper
// ---------------------------------------------------------------------------
export async function closePortal(session: AdapterSession): Promise<void> {
  await session.close();
}
