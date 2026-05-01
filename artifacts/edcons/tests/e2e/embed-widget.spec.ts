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
import { execSync } from "node:child_process";
import path from "node:path";

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

/**
 * Full apply submission flow (Task #87).
 *
 * The other desktop tests cover the modal *opening*, but none of them
 * fill out and submit the form. A regression in the submission endpoint,
 * server-side validation, transaction logic, or the success-state UI
 * would slip through. This describe block walks the user through the
 * complete happy path:
 *
 *   1. Load the host page with the seeded `e2e-embed-test` widget
 *      (no allowedDomains => loadable from localhost).
 *   2. Click "Apply Now" on the first program card.
 *   3. The modal opens at the upload step. Click "Skip, fill manually"
 *      to bypass document upload + AI analysis (which would require a
 *      real LLM call) and jump straight to the form step.
 *   4. Fill the three required fields (firstName, lastName, email).
 *      Use a unique e2e-namespaced email so the verification query has
 *      a stable handle even if the suite is re-run rapidly.
 *   5. Click "Submit Application".
 *   6. Assert the success UI (`<div class="ew-success">` with the
 *      "Application Submitted!" heading) replaces the form.
 *   7. Out-of-band, run the verify-submission script to confirm an
 *      `embed_submissions` row was actually written for this widget +
 *      email, with the matching first/last name and a populated lead_id
 *      (route inserts both lead + submission in a single transaction).
 *
 * Cleanup: the existing teardown in
 * `artifacts/api-server/scripts/e2e-embed-fixtures-teardown.ts` already
 * handles this — when the e2e setup created the widget, dropping the
 * widget cascade-deletes its `embed_submissions` rows (FK is
 * `onDelete: "cascade"`); when the widget was reused, the teardown
 * explicitly deletes its submissions; in both branches it also deletes
 * the linked lead rows (source LIKE 'embed:%') and any documents.
 *
 * Tagged @desktop so this only runs on chromium-desktop, not on every
 * mobile viewport (the submission flow is viewport-independent and
 * already covered for layout by the @mobile modal test).
 */
test.describe("embed widget — apply submission", { tag: "@desktop" }, () => {
  test("fills the apply form, submits, shows success, and writes embed_submissions row", async ({
    page,
  }) => {
    await loadHost(page);
    const widget = await getWidgetIframe(page);

    // Wait for the program list to render so the Apply Now button exists.
    await expect(widget.locator(".ew-card").first()).toBeVisible({
      timeout: 10_000,
    });

    // Open the modal.
    await widget
      .locator(".ew-card .ew-btn", { hasText: /apply now/i })
      .first()
      .click();
    await expect(widget.locator(".ew-modal")).toBeVisible({ timeout: 5_000 });

    // The modal opens at the upload step ("Apply — <program>" with a
    // grid of 4 document slots). Skip straight to the form step — the
    // upload+AI path needs a real LLM round-trip, which is out of scope
    // for the submission-flow regression test.
    //
    // We use `dispatchEvent("click")` (rather than `click()`) for the
    // in-modal interactions: the modal is `position:absolute` inside
    // the widget iframe and can extend past the iframe's CSS box (the
    // iframe doesn't auto-grow with absolutely positioned children).
    // Playwright's viewport-bounds heuristic then refuses both the
    // normal click and `click({force:true})` because the click point
    // sits below the iframe's parent-page-visible region.
    // `dispatchEvent` skips that bounds check while still firing the
    // real click handler the widget JS bound at line 1187 of
    // routes/embed.ts. The button being live in the DOM is still
    // verified by `toBeVisible()` immediately above.
    const skipBtn = widget.locator("#ew-skip-btn");
    await expect(skipBtn).toBeVisible({ timeout: 5_000 });
    await skipBtn.dispatchEvent("click");
    const form = widget.locator("#ew-form");
    await expect(form).toBeVisible({ timeout: 5_000 });

    // Unique per-run email so we can deterministically find this row
    // even if the suite is re-run quickly (the teardown deletes by
    // widgetId so leftover rows from a crashed prior run don't shadow
    // this one — but the unique email is cheap insurance).
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const submittedEmail = `e2e-apply-${runId}@e2e.test`;
    const firstName = "E2EApply";
    const lastName = `Run${runId}`;

    // Same iframe-quirk reason as the skip button: Playwright's `fill`
    // also runs the viewport check. Set the values directly and then
    // dispatch `input`/`change` so any JS listeners fire — the widget's
    // `handleFormSubmit` (routes/embed.ts L1242) reads via `new
    // FormData(form)`, which only needs the value to be set.
    async function setFieldValue(name: string, value: string) {
      await form.locator(`input[name="${name}"]`).evaluate((el, v) => {
        const input = el as HTMLInputElement;
        input.value = v;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
    }
    await setFieldValue("firstName", firstName);
    await setFieldValue("lastName", lastName);
    await setFieldValue("email", submittedEmail);

    // Submit. Calling `requestSubmit()` on the form fires the same
    // `submit` event that `handleFormSubmit` is bound to (line 1170 of
    // routes/embed.ts), and goes through the form's native validation
    // (so a missing required field would still block). The button is
    // the only `button[type="submit"]` in the modal — assert it
    // exists/is visible first so a regression that removes it still
    // surfaces here.
    const submitBtn = form.locator('button[type="submit"]', {
      hasText: /submit application/i,
    });
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });
    // `toBeEnabled` guards against a UX regression where the submit
    // button gets disabled (e.g. spinner state stuck on, missing
    // required field). `requestSubmit()` ignores button state, so this
    // explicit check is what surfaces such a regression.
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await form.evaluate((el) => (el as HTMLFormElement).requestSubmit());

    // Success UI: renderSuccess() replaces the form contents with a
    // `<div class="ew-success">` containing an `<h3>Application
    // Submitted!</h3>`. The form itself disappears.
    const success = widget.locator(".ew-success");
    await expect(success).toBeVisible({ timeout: 10_000 });
    await expect(success.locator("h3")).toHaveText(/application submitted/i);
    await expect(form).toHaveCount(0);

    // Verify the row landed in `embed_submissions` for this widget.
    // Done out-of-band via a tiny tsx script so we don't have to plumb
    // admin auth or a dev-only HTTP endpoint into the test runner.
    //
    // `tsx` is a dependency of `@workspace/api-server`, not the
    // workspace root, so we must scope the exec via `pnpm --filter`.
    // The script path is relative to that package's directory.
    const verifyScript = path.join(
      "scripts",
      "e2e-embed-verify-submission.ts",
    );
    let raw: string;
    try {
      raw = execSync(
        `pnpm --filter @workspace/api-server exec tsx ${verifyScript} --slug ${EMBED_SLUG} --email ${submittedEmail}`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
      throw new Error(
        `verify-submission script failed (exit=${e.status ?? "?"})\n` +
          `stdout: ${e.stdout?.toString() ?? ""}\n` +
          `stderr: ${e.stderr?.toString() ?? ""}`,
      );
    }

    const row = JSON.parse(raw) as {
      id: number;
      widgetId: number;
      email: string;
      firstName: string;
      lastName: string;
      leadId: number | null;
      status: string;
      lead: {
        id: number;
        firstName: string;
        lastName: string;
        email: string | null;
        source: string | null;
        status: string;
      } | null;
    };

    expect(row.id).toBeGreaterThan(0);
    expect(row.widgetId).toBeGreaterThan(0);
    expect(row.email.toLowerCase()).toBe(submittedEmail.toLowerCase());
    expect(row.firstName).toBe(firstName);
    expect(row.lastName).toBe(lastName);
    // The route inserts the lead first, then the submission with that
    // lead's id, in a single transaction. A null leadId would mean the
    // transaction broke and only the submission half landed.
    expect(row.leadId).not.toBeNull();
    expect(row.leadId).toBeGreaterThan(0);
    expect(row.status).toBe("new");

    // The route also writes a `leads` row tagged `embed:<slug>` and
    // wires it back as the FK target. Asserting the lead payload here
    // catches a regression that lands the submission but skips/breaks
    // the lead insert (or mis-tags `source`).
    expect(row.lead).not.toBeNull();
    expect(row.lead!.id).toBe(row.leadId);
    expect(row.lead!.firstName).toBe(firstName);
    expect(row.lead!.lastName).toBe(lastName);
    expect(row.lead!.email?.toLowerCase()).toBe(submittedEmail.toLowerCase());
    expect(row.lead!.source).toBe(`embed:${EMBED_SLUG}`);
    expect(row.lead!.status).toBe("new");
  });
});
