/**
 * Playwright e2e for the embeddable apply widget.
 *
 * Permanent regression coverage for the recent embed loader fixes:
 *   - Task #82: cross-origin loader / iframe injection.
 *   - Task #83: mobile modal positioning, scroll lock during modal,
 *     scroll position restored on close.
 *
 * The test does NOT load the widget through the edcons app. Instead, it
 * builds a small synthetic host page in-memory via page.setContent(),
 * drops in the public embed loader (`/api/public/embed/embed.js`), and
 * asserts that:
 *
 *   1. The loader injects an <iframe> into the host page.
 *   2. The widget HTML inside the iframe lists at least one program
 *      (or shows the empty state) — i.e. the public programs API works.
 *   3. Clicking "Apply Now" on a program opens the apply modal inside
 *      the iframe.
 *   4. While the modal is open, the host page body has scroll lock
 *      applied (position:fixed) and cannot scroll.
 *   5. On mobile viewport, the modal stays inside the visible viewport
 *      (top + height fit within parent viewport).
 *   6. Closing the modal restores the original scroll position on the
 *      host page.
 *
 * Fixtures (test university + program + widget with slug
 * `e2e-embed-test`) are seeded by playwright globalSetup via
 * `artifacts/api-server/scripts/e2e-embed-fixtures.ts`.
 */
import { test, expect, request as pwRequest, type Page, type FrameLocator } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:25197";
const EMBED_SLUG = "e2e-embed-test";

/**
 * The allowlist-widget fixture (seeded by
 * `artifacts/api-server/scripts/e2e-embed-fixtures.ts`) has
 * `allowedDomains: ["allowed.e2e.example.com"]`. Keep these constants
 * in sync with the fixture script.
 */
const EMBED_ALLOWLIST_SLUG = "e2e-embed-test-allowlist";
const ALLOWED_ORIGIN = "https://allowed.e2e.example.com";
const ALLOWED_REFERER = "https://allowed.e2e.example.com/programs";
const DISALLOWED_ORIGIN = "https://attacker.e2e.example.com";
const DISALLOWED_REFERER = "https://attacker.e2e.example.com/embed-page";

/**
 * The host page lives at /e2e-embed-host.html on the dev server domain so
 * that `window.parent.location.href` resolves cleanly inside the iframe.
 * We use a small dummy file under public/ that just loads the loader and
 * provides a tall scrollable area above the widget.
 */
function buildHostHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Embed Widget E2E Host</title>
<style>
  body { margin: 0; font-family: sans-serif; }
  #spacer-top { height: 120px; background: linear-gradient(#fafafa,#eee); padding: 24px; }
  #widget-host { padding: 16px; background: #fff; }
  #spacer-bottom { height: 1500px; background: linear-gradient(#eee,#ddd); padding: 24px; }
</style>
</head>
<body>
<div id="spacer-top">Top spacer (forces scroll above the widget).</div>
<div id="widget-host"><div data-edcons-widget="${EMBED_SLUG}"></div></div>
<div id="spacer-bottom">Bottom spacer.</div>
<script src="${BASE_URL}/api/public/embed/embed.js"></script>
</body>
</html>`;
}

async function loadHost(page: Page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.setContent(buildHostHtml(), { waitUntil: "load" });
  // Force the lazy-loaded iframe to start loading immediately, then reset
  // host scroll so individual tests start from a known position.
  const iframeLocator = page.locator("#widget-host iframe");
  await expect(iframeLocator).toHaveCount(1, { timeout: 10_000 });
  await iframeLocator.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function getWidgetIframe(page: Page): Promise<FrameLocator> {
  const iframeEl = page.locator("#widget-host iframe");
  await expect(iframeEl).toHaveCount(1, { timeout: 10_000 });
  await expect(iframeEl).toHaveAttribute("src", new RegExp(`/api/public/embed/${EMBED_SLUG}/widget`));
  return page.frameLocator("#widget-host iframe");
}

test.describe("embed widget — desktop", { tag: "@desktop" }, () => {
  test("loader injects iframe and renders the program list", async ({ page }) => {
    await loadHost(page);
    const widget = await getWidgetIframe(page);

    // The fixture guarantees at least one active program exists for this
    // widget, so we should always see at least one card and never the
    // empty state. Wait for cards to appear.
    const cards = widget.locator(".ew-card");
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    expect(await cards.count()).toBeGreaterThan(0);
    await expect(widget.locator(".ew-empty")).toHaveCount(0);

    // Apply Now button must be present on the card.
    await expect(
      widget.locator(".ew-card .ew-btn", { hasText: /apply now/i }).first(),
    ).toBeVisible();
  });

  test("opening apply modal locks scroll and restores it on close", async ({ page }) => {
    await loadHost(page);
    const widget = await getWidgetIframe(page);

    await expect(widget.locator(".ew-card").first()).toBeVisible({ timeout: 10_000 });

    // Scroll the host page so we can later assert restoration. The widget
    // is small (spacer-top 120px) so the apply button stays in viewport
    // without Playwright auto-scrolling on click.
    await page.evaluate(() => window.scrollTo(0, 200));

    // Click the first Apply Now button.
    await widget.locator(".ew-card .ew-btn", { hasText: /apply now/i }).first().click();

    // Modal must appear inside the iframe.
    const modalOverlay = widget.locator(".ew-modal-overlay");
    const modal = widget.locator(".ew-modal");
    await expect(modalOverlay).toBeVisible({ timeout: 5_000 });
    await expect(modal).toBeVisible();

    // Scroll lock: host body should be position:fixed while modal is open.
    await expect.poll(
      async () => page.evaluate(() => document.body.style.position),
      { timeout: 3_000 },
    ).toBe("fixed");

    // The loader stores the captured scroll in `body.style.top` as
    // negative pixels — extract it so we can assert restoration even if
    // Playwright auto-scrolled the page slightly when clicking apply.
    const savedScrollFromLoader = await page.evaluate(() => {
      const top = document.body.style.top;
      return top ? Math.abs(parseInt(top, 10)) : 0;
    });
    expect(savedScrollFromLoader).toBeGreaterThan(0);

    // Attempting to scroll the host page must NOT change the visible scroll.
    const lockedScroll = await page.evaluate(() => {
      window.scrollTo(0, 1000);
      return Math.round(window.scrollY);
    });
    expect(lockedScroll).toBe(0); // body fixed -> scrollY clamps to 0

    // Close the modal via the close button.
    await widget.locator("#ew-modal-close").click();
    await expect(modalOverlay).toHaveCount(0, { timeout: 5_000 });

    // Scroll lock removed and original scroll restored.
    await expect.poll(
      async () => page.evaluate(() => document.body.style.position),
      { timeout: 3_000 },
    ).toBe("");
    await expect.poll(
      async () => page.evaluate(() => Math.round(window.scrollY)),
      { timeout: 3_000 },
    ).toBe(savedScrollFromLoader);
  });
});

/**
 * Mobile modal coverage.
 *
 * Tagged @mobile so playwright.config.ts can route this to multiple
 * mobile-viewport projects (small Android, large iPhone, tablet
 * portrait) and — when RUN_WEBKIT_E2E=1 — to a WebKit iOS Safari
 * project. The viewport itself is set by the project, NOT here, so
 * the same test exercises every form factor without copy-paste.
 */
test.describe("embed widget — mobile", { tag: "@mobile" }, () => {
  test("modal stays inside the visible viewport on mobile", async ({ page }, testInfo) => {
    await loadHost(page);
    const widget = await getWidgetIframe(page);

    await expect(widget.locator(".ew-card").first()).toBeVisible({ timeout: 10_000 });

    // Scroll the host a small amount so the modal positioning logic has
    // a non-zero parent scroll to react to. Use a small fraction of the
    // current viewport so the apply button stays in view across all
    // mobile viewports (360x740 .. 768x1024).
    const viewportH = page.viewportSize()?.height ?? 700;
    const initialScroll = Math.min(80, Math.floor(viewportH * 0.1));
    await page.evaluate((y) => window.scrollTo(0, y), initialScroll);

    // Open the modal.
    await widget
      .locator(".ew-card .ew-btn", { hasText: /apply now/i })
      .first()
      .click();

    const modal = widget.locator(".ew-modal");
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // The modal must fit inside the parent (mobile) viewport. Compute the
    // modal's bounding box in the parent viewport's coordinate system by
    // adding the iframe's offset.
    const modalInfo = await widget.locator(".ew-modal").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        topInIframe: r.top,
        height: r.height,
        maxHeight: parseFloat((el as HTMLElement).style.maxHeight) || 0,
      };
    });
    const iframeTopInParent = await page.locator("#widget-host iframe").evaluate(
      (el) => el.getBoundingClientRect().top,
    );
    const viewportHeight = await page.evaluate(() => window.innerHeight);

    const modalTopInParent = iframeTopInParent + modalInfo.topInIframe;

    // Helpful diagnostics so a viewport-specific failure tells us which
    // form factor blew up without grepping junit XML.
    testInfo.annotations.push({
      type: "viewport",
      description: `${page.viewportSize()?.width}x${page.viewportSize()?.height}`,
    });

    // Modal must be at least partially visible in the parent viewport
    // (top within viewport). Allow a 16px tolerance for rounding/layout shifts.
    expect(modalTopInParent).toBeGreaterThanOrEqual(-16);
    expect(modalTopInParent).toBeLessThan(viewportHeight);
    expect(modalInfo.height).toBeGreaterThan(120);
    // The applied max-height must be bounded by the parent viewport height.
    expect(modalInfo.maxHeight).toBeLessThanOrEqual(viewportHeight);

    // Scroll lock must be active on mobile too.
    await expect
      .poll(async () => page.evaluate(() => document.body.style.position), {
        timeout: 3_000,
      })
      .toBe("fixed");
  });
});

/**
 * Allowed-domains restriction.
 *
 * Production widgets are typically created with a non-empty
 * `allowedDomains` list so a partner can't have someone else embed
 * their widget on a hostile site. The seeded `EMBED_ALLOWLIST_SLUG`
 * widget has `allowedDomains: [ALLOWED_DOMAIN]` and the public API
 * routes (`/config`, `/programs`, `/apply`) gate on the request's
 * `Origin` / `Referer` headers via `validateDomain` in
 * `artifacts/api-server/src/routes/embed.ts`.
 *
 * These tests directly exercise that gate by making API requests with
 * an explicit Origin+Referer pair (the way a real browser would behave
 * when a partner page calls the widget's public endpoints) and assert:
 *
 *   - allowed origin  -> 200, returns the widget config / programs
 *   - disallowed      -> 403 with the "Domain not allowed" error
 *   - missing both    -> 403 (no headers means no way to verify)
 *
 * Tagged @desktop so it only runs on the chromium-desktop project,
 * not on every mobile-viewport project (the restriction is independent
 * of viewport).
 */
test.describe("embed widget — allowed-domains", { tag: "@desktop" }, () => {
  test("public /config returns 200 when called from an allowed origin", async () => {
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: {
        Origin: ALLOWED_ORIGIN,
        Referer: ALLOWED_REFERER,
      },
    });
    try {
      const res = await ctx.get(
        `${BASE_URL}/api/public/embed/${EMBED_ALLOWLIST_SLUG}/config`,
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.slug).toBe(EMBED_ALLOWLIST_SLUG);
      expect(body.mode).toBe("combined");
    } finally {
      await ctx.dispose();
    }
  });

  test("public /programs returns 200 when called from an allowed origin", async () => {
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: {
        Origin: ALLOWED_ORIGIN,
        Referer: ALLOWED_REFERER,
      },
    });
    try {
      const res = await ctx.get(
        `${BASE_URL}/api/public/embed/${EMBED_ALLOWLIST_SLUG}/programs`,
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta).toBeDefined();
    } finally {
      await ctx.dispose();
    }
  });

  test("public /config is rejected with 403 from a disallowed origin", async () => {
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: {
        Origin: DISALLOWED_ORIGIN,
        Referer: DISALLOWED_REFERER,
      },
    });
    try {
      const res = await ctx.get(
        `${BASE_URL}/api/public/embed/${EMBED_ALLOWLIST_SLUG}/config`,
      );
      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/domain not allowed/i);
    } finally {
      await ctx.dispose();
    }
  });

  test("public /programs is rejected with 403 from a disallowed origin", async () => {
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: {
        Origin: DISALLOWED_ORIGIN,
        Referer: DISALLOWED_REFERER,
      },
    });
    try {
      const res = await ctx.get(
        `${BASE_URL}/api/public/embed/${EMBED_ALLOWLIST_SLUG}/programs`,
      );
      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/domain not allowed/i);
    } finally {
      await ctx.dispose();
    }
  });

  test("public /apply is rejected with 403 from a disallowed origin", async () => {
    // Belt-and-suspenders: even a POST that would otherwise succeed
    // (valid payload) must be blocked when the request comes from a
    // host that isn't on the allowlist. The submission endpoint is the
    // most important one to lock down because it writes leads.
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: {
        Origin: DISALLOWED_ORIGIN,
        Referer: DISALLOWED_REFERER,
      },
    });
    try {
      const res = await ctx.post(
        `${BASE_URL}/api/public/embed/${EMBED_ALLOWLIST_SLUG}/apply`,
        {
          data: {
            firstName: "Disallowed",
            lastName: "Origin",
            email: "disallowed-origin@e2e.test",
          },
        },
      );
      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/domain not allowed/i);
    } finally {
      await ctx.dispose();
    }
  });

  test("public /config is rejected with 403 when no Origin/Referer is sent", async () => {
    // Sanity check on `validateDomain`'s "no headers => block" branch:
    // a populated allowedDomains list must not be bypassable by simply
    // omitting both headers (e.g. a server-side cURL).
    const ctx = await pwRequest.newContext();
    try {
      const res = await ctx.get(
        `${BASE_URL}/api/public/embed/${EMBED_ALLOWLIST_SLUG}/config`,
        { headers: { Referer: "" } },
      );
      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/domain not allowed/i);
    } finally {
      await ctx.dispose();
    }
  });
});
