import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import type { Page, BrowserContext, Browser } from "playwright-core";
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
// Chromium binary resolution
//
// On Replit the browser is provided by Nix (pkgs.chromium in replit.nix) rather
// than downloaded by Playwright, so we point playwright-core at it explicitly.
// .replit exports PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH; if missing we fall back
// to `which chromium` on PATH.  Returning undefined lets playwright-core try its
// own bundled lookup as a last resort (works in vanilla Node environments).
// ---------------------------------------------------------------------------
function resolveChromiumPath(): string | undefined {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (fromEnv) return fromEnv;
  try {
    const found = execSync("which chromium", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (found) return found;
  } catch {
    /* fall through */
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Memory-optimised Chromium launch args
//
// These flags are mandatory for Replit (constrained RAM + no /dev/shm):
//   --disable-dev-shm-usage   use /tmp instead of /dev/shm (prevents ENOMEM)
//   --no-sandbox              required when running as root inside container
//   --disable-gpu             no GPU on server; avoids GPU-process memory overhead
//   --disable-extensions      no extensions — saves ~20 MB per browser instance
//   --disable-background-networking  stops background XHRs that keep V8 alive
// ---------------------------------------------------------------------------
const MEM_ARGS: string[] = [
  "--disable-dev-shm-usage",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-translate",
  "--metrics-recording-only",
  "--mute-audio",
  "--no-first-run",
];

// ---------------------------------------------------------------------------
// Launch options
// ---------------------------------------------------------------------------
export interface LaunchOpts {
  /**
   * Ignored — browser is ALWAYS launched headless to minimise RAM usage.
   * Kept in the interface for backwards-compat; callers need not change.
   */
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
//
// Browser is ALWAYS headless regardless of the opts.headless field.
// Each submission must open its own browser and close it via session.close()
// in a finally block — never reuse a browser across submissions.
// ---------------------------------------------------------------------------
export async function launchPortal(opts: LaunchOpts = {}): Promise<AdapterSession> {
  const { storagePath } = opts;

  const executablePath = resolveChromiumPath();

  const browser: Browser = await chromium.launch({
    headless: true,
    args: MEM_ARGS,
    ...(executablePath ? { executablePath } : {}),
  });

  const context: BrowserContext = await browser.newContext(
    storagePath
      ? { storageState: storagePath, ignoreHTTPSErrors: true }
      : { ignoreHTTPSErrors: true },
  );
  const page: Page = await context.newPage();

  return {
    page,
    /**
     * Close in dependency order: page → context → browser.
     * Each step is wrapped so a failure in one doesn't prevent the others.
     */
    async close(): Promise<void> {
      try { await page.close();    } catch { /* ignore */ }
      try { await context.close(); } catch { /* ignore */ }
      try { await browser.close(); } catch { /* ignore */ }
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
