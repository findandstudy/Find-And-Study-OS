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
 * Allowlist-widget fixtures (seeded by
 * `artifacts/api-server/scripts/e2e-embed-fixtures.ts`). Keep these
 * constants in sync with the fixture script.
 *
 *   - PERMISSIVE: allowedDomains=["localhost","127.0.0.1"]. The Playwright
 *     dev server is at http://localhost:25197, so the iframe's same-origin
 *     /config + /programs fetches have Referer hostname=localhost — i.e.
 *     IN the allowlist. Used to assert the loader renders normally.
 *
 *   - STRICT: allowedDomains=["allowed.e2e.example.com"]. The iframe loaded
 *     from localhost is NOT in the allowlist, so /config returns 403 and
 *     the widget JS catches the error + renders its `.ew-empty`
 *     "Unable to load widget" state. Used to assert the loader refuses to
 *     render. Also used by the API-level allow/deny tests via explicit
 *     Origin/Referer headers.
 */
const EMBED_ALLOWLIST_PERMISSIVE_SLUG = "e2e-embed-test-allowlist-permissive";
const EMBED_ALLOWLIST_STRICT_SLUG = "e2e-embed-test-allowlist-strict";
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
function buildHostHtml(slug: string = EMBED_SLUG): string {
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
<div id="widget-host"><div data-edcons-widget="${slug}"></div></div>
<div id="spacer-bottom">Bottom spacer.</div>
<script src="${BASE_URL}/api/public/embed/embed.js"></script>
</body>
</html>`;
}

async function loadHost(page: Page, slug: string = EMBED_SLUG) {
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.setContent(buildHostHtml(slug), { waitUntil: "load" });
  // Force the lazy-loaded iframe to start loading immediately, then reset
  // host scroll so individual tests start from a known position.
  const iframeLocator = page.locator("#widget-host iframe");
  await expect(iframeLocator).toHaveCount(1, { timeout: 10_000 });
  await iframeLocator.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function getWidgetIframe(
  page: Page,
  slug: string = EMBED_SLUG,
): Promise<FrameLocator> {
  const iframeEl = page.locator("#widget-host iframe");
  await expect(iframeEl).toHaveCount(1, { timeout: 10_000 });
  await expect(iframeEl).toHaveAttribute(
    "src",
    new RegExp(`/api/public/embed/${slug}/widget`),
  );
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
 * their widget on a hostile site. The public API routes (`/config`,
 * `/programs`, `/apply`) gate on the request's `Origin` / `Referer`
 * headers via `validateDomain` in
 * `artifacts/api-server/src/routes/embed.ts`.
 *
 * Two angles of coverage:
 *
 *   1) Loader/iframe end-to-end (the user-facing flow): embed the
 *      widget on the test host page (served from localhost) and assert
 *      what the user actually sees.
 *        - PERMISSIVE widget (allowedDomains includes "localhost") ->
 *          program cards render.
 *        - STRICT widget (allowedDomains excludes localhost) -> the
 *          widget catches the 403 and shows the "Unable to load widget"
 *          empty state; no cards appear.
 *
 *   2) Public-API direct (covers cases the loader-flow can't fake,
 *      because browsers control the Origin/Referer headers): drive the
 *      gate with explicit headers a real partner-side request would
 *      send.
 *        - allowed Origin/Referer -> 200, real config/programs payload
 *        - disallowed Origin/Referer -> 403 + "Domain not allowed"
 *        - missing both headers -> 403 (server-side cURL can't bypass)
 *
 * Tagged @desktop so it only runs on the chromium-desktop project, not
 * on every mobile-viewport project (the restriction is independent of
 * viewport).
 */
test.describe("embed widget — allowed-domains", { tag: "@desktop" }, () => {
  test("loader iframe renders program cards when embedded on an allowed origin", async ({
    page,
  }) => {
    // PERMISSIVE widget: allowedDomains=["localhost","127.0.0.1"]. The
    // dev server runs at http://localhost:25197 so the iframe's
    // same-origin /config + /programs fetches have Referer hostname=
    // localhost — IN the allowlist — and the widget should render
    // normally. This is the "renders normally on allowed origin"
    // acceptance criterion expressed end-to-end.
    await loadHost(page, EMBED_ALLOWLIST_PERMISSIVE_SLUG);
    const widget = await getWidgetIframe(page, EMBED_ALLOWLIST_PERMISSIVE_SLUG);

    // The seeded program (fixtures.ts -> EMBED_TEST_PROGRAM) is the
    // only active record for the seeded university so at least one
    // .ew-card is expected once /config + /programs both succeed.
    await expect(widget.locator(".ew-card").first()).toBeVisible({ timeout: 15_000 });
    await expect(widget.locator(".ew-empty")).toHaveCount(0);
  });

  test("loader iframe shows the empty/error state when embedded on a disallowed origin", async ({
    page,
  }) => {
    // STRICT widget: allowedDomains=["allowed.e2e.example.com"]. The
    // iframe is loaded from localhost so its same-origin /config call
    // has Referer hostname=localhost — NOT in the allowlist — and the
    // server returns 403. The widget JS in `generateWidgetHTML`
    // catches the failed fetch and renders
    // `<div class="ew-empty"><p>Unable to load widget</p></div>`.
    // This is the "refuses to render on disallowed origin" criterion.
    await loadHost(page, EMBED_ALLOWLIST_STRICT_SLUG);
    const widget = await getWidgetIframe(page, EMBED_ALLOWLIST_STRICT_SLUG);

    await expect(widget.locator(".ew-empty")).toBeVisible({ timeout: 15_000 });
    await expect(widget.locator(".ew-empty p")).toContainText(/unable to load widget/i);
    // No program cards must leak through — even momentarily — because
    // /config failed before /programs was ever called.
    await expect(widget.locator(".ew-card")).toHaveCount(0);
  });

  test("public /config returns 200 when called from an allowed origin", async () => {
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: {
        Origin: ALLOWED_ORIGIN,
        Referer: ALLOWED_REFERER,
      },
    });
    try {
      const res = await ctx.get(
        `${BASE_URL}/api/public/embed/${EMBED_ALLOWLIST_STRICT_SLUG}/config`,
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.slug).toBe(EMBED_ALLOWLIST_STRICT_SLUG);
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
        `${BASE_URL}/api/public/embed/${EMBED_ALLOWLIST_STRICT_SLUG}/programs`,
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
        `${BASE_URL}/api/public/embed/${EMBED_ALLOWLIST_STRICT_SLUG}/config`,
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
        `${BASE_URL}/api/public/embed/${EMBED_ALLOWLIST_STRICT_SLUG}/programs`,
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
        `${BASE_URL}/api/public/embed/${EMBED_ALLOWLIST_STRICT_SLUG}/apply`,
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
        `${BASE_URL}/api/public/embed/${EMBED_ALLOWLIST_STRICT_SLUG}/config`,
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
