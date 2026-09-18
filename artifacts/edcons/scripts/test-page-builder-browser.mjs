// Built-application smoke test. API responses are synthetic; no live account is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const requireApi = createRequire(new URL('../../api-server/package.json', import.meta.url));
const { chromium } = requireApi('playwright-core');
const root = fileURLToPath(new URL('../dist/public/', import.meta.url));
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = path.extname(pathname) ? pathname.slice(1) : 'index.html';
    const target = path.resolve(root, relative);
    if (!target.startsWith(path.resolve(root) + path.sep)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', mime[path.extname(target)] || 'text/html');
    res.end(await readFile(target));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [locale, width] of [['en', 1440], ['tr', 390], ['ar', 390]]) {
    for (const layout of ['grid', 'list', 'carousel']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        const isTemplate = /^\/api\/website\/pages\/(home|about)$/.test(url.pathname);
        const body = isTemplate ? { data: { id: 2, title: 'Published fixture', versionNumber: 2, blocks: [
          { blockType: 'hero', content: { title: 'Published fixture heading' }, settings: {}, sortOrder: 0 },
          { blockType: 'catalog_grid', content: { title: 'Fixture catalogue', source: 'universities', layout, columns: 4, items: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, title: `University ${i}`, description: 'Synthetic programme catalogue item', canonicalPath: `/${locale}/universities/fixture-${i + 1}` })) }, settings: {}, sortOrder: 1 },
        ], seo: { ogTitle: 'Published OG fixture', robotsFollow: false } }, meta: { title: 'Published SEO fixture', description: 'Published description', indexable: false, canonicalPath: `/${locale}/about`, alternatePaths: {} } } : url.pathname.includes('branding') || url.pathname.includes('settings') ? {} : [];
        await route.fulfill({ status: url.pathname === '/api/auth/me' ? 401 : 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(`${base}/${locale}/about`);
      await page.getByRole('heading', { name: 'Published fixture heading' }).waitFor();
      assert.match(await page.title(), /Published SEO fixture/);
      assert.equal(await page.locator('meta[property="og:title"]').getAttribute('content'), 'Published OG fixture');
      assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow');
      assert.equal(await page.locator('link[hreflang]').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${locale}/${layout} must not overflow viewport`);
      if (layout === 'carousel') assert.equal(await page.locator('[aria-label="Fixture catalogue"]').getAttribute('tabindex'), '0');
      if (locale === 'ar') assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
      assert.deepEqual(errors, []);
      console.log(`PASS built About ${locale} ${width}px ${layout} SEO and overflow`);
      if (layout === 'grid') {
        await page.goto(`${base}/${locale}`);
        await page.getByRole('heading', { name: 'Published fixture heading' }).waitFor();
        console.log(`PASS published Home ${locale}`);
      }
      await page.close();
    }
  }
  for (const status of [404, 503]) {
    const page = await browser.newPage();
    await page.route('**/api/**', route => route.fulfill({ status: route.request().url().includes('/website/pages/') ? status : 200, contentType: 'application/json', body: route.request().url().includes('branding') ? '{}' : '[]' }));
    await page.goto(`${base}/about`);
    await page.waitForURL('**/en/about');
    await page.getByRole('heading', { name: /Our Mission/i }).waitFor();
    assert.equal(await page.locator('[data-public-page-version]').count(), 0);
    await page.goto(`${base}/en`);
    await page.getByRole('heading', { name: /Everything You Need/i }).waitFor();
    console.log(`PASS ${status} static Home/About fallback and /about redirect`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
