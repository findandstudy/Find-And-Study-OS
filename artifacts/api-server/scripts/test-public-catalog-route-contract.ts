import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  PUBLIC_CATALOG_RELATED_LIMIT,
  PUBLIC_CATALOG_RELATED_CANDIDATE_LIMIT,
  PUBLIC_CATALOG_UNIVERSITY_PROGRAM_LIMIT,
  parsePublicCatalogRouteKey,
  parsePublicWebInternalLinkMode,
  publicCatalogCanonicalState,
  publicCatalogPath,
  publicCatalogRouteKey,
  publicCatalogSlug,
} from "../src/lib/publicCatalogRouteContract";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("catalogue slugs are stable, bounded, and ASCII-safe", () => {
  assert.equal(publicCatalogSlug("İşletme ve Yönetim (MSc)"), "isletme-ve-yonetim-msc");
  assert.equal(publicCatalogRouteKey(42, "Computer Science"), "computer-science-42");
  assert.equal(publicCatalogSlug("***"), "item");
  assert.ok(publicCatalogSlug("a".repeat(300)).length <= 150);
});

test("route identities reject ambiguous and unsafe input", () => {
  assert.deepEqual(parsePublicCatalogRouteKey("computer-science-42"), {
    id: 42,
    slug: "computer-science",
    routeKey: "computer-science-42",
  });
  for (const invalid of ["42", "../program-42", "program-0", "program-999999999999", "Program 42", "x".repeat(181)]) {
    assert.equal(parsePublicCatalogRouteKey(invalid), null);
  }
});

test("canonical paths normalize locale and detect stale slugs", () => {
  assert.equal(parsePublicWebInternalLinkMode(undefined), "off");
  assert.equal(parsePublicWebInternalLinkMode("PUBLISHED"), "published");
  assert.equal(parsePublicWebInternalLinkMode("enabled"), "off");
  assert.equal(
    publicCatalogPath({ locale: "tr-TR", entityType: "program", id: 7, name: "Tıp" }),
    "/tr/programs/tip-7",
  );
  assert.equal(
    publicCatalogPath({ locale: "xx", entityType: "university", id: 3, name: "Example University" }),
    "/en/universities/example-university-3",
  );
  assert.deepEqual(
    publicCatalogCanonicalState({
      requestedRouteKey: "old-name-7",
      locale: "tr",
      entityType: "program",
      id: 7,
      name: "Tıp",
    }),
    {
      routeKey: "tip-7",
      canonicalPath: "/tr/programs/tip-7",
      isCanonical: false,
    },
  );
});

test("public catalogue detail APIs are bounded and never select private CRM fields", () => {
  const route = read("../src/routes/public-catalog.ts");
  const renderReadModel = read("../src/lib/publicCatalogRenderReadModel.ts");
  const invalidationBus = read("../src/lib/publicCatalogInvalidationBus.ts");
  const localizedRequirements = "requirements: sql<string | null>`COALESCE(${programTranslationsTable.requirements}, ${programsTable.requirements})`";
  assert.ok(route.includes(localizedRequirements), "API requirements prefer the published translation");
  assert.ok(renderReadModel.includes(localizedRequirements), "SSR requirements match the API translation projection");
  const priceReadModel = read("../src/lib/publicCatalogPriceReadModel.ts");
  const destinations = read("../src/routes/destinations.ts");
  const detailContent = read("../src/lib/websiteDetailContent.ts");
  const publicWeb = read("../src/routes/public-web.ts");
  const websiteAdmin = read("../src/routes/website.ts");
  const catalogAdmin = read("../src/routes/catalog.ts");
  const universitiesAdmin = read("../src/routes/universities.ts");
  const translationQueue = read("../src/lib/programTranslationQueue.ts");
  const exampleEnvironment = read("../../../.env.example");
  assert.equal(PUBLIC_CATALOG_RELATED_LIMIT, 8);
  assert.equal(PUBLIC_CATALOG_RELATED_CANDIDATE_LIMIT, 32);
  assert.equal(PUBLIC_CATALOG_UNIVERSITY_PROGRAM_LIMIT, 12);
  assert.doesNotMatch(route, /commissionRate|serviceFeeAmount|contactPerson(Name|Phone|Email)/);
  assert.match(route, /import \{ readPublicCatalogPrices \} from "\.\.\/lib\/publicCatalogPriceReadModel"/);
  assert.match(route, /readPublicCatalogPrices\(\[program\.id\], now\)/);
  assert.match(renderReadModel, /import \{ readPublicCatalogPrices \} from "\.\/publicCatalogPriceReadModel"/);
  assert.match(renderReadModel, /readPublicCatalogPrices\(\[program\.id\], now\)/);
  assert.match(priceReadModel, /s\.status = 'ACTIVE' AND r\.status = 'VERIFIED' AND r\.entity_type = 'PRICE'/);
  assert.match(priceReadModel, /r\.verified_at <= \$\{now\} AND r\.effective_at <= \$\{now\}/);
  assert.match(priceReadModel, /r\.expires_at IS NULL OR r\.expires_at >= \$\{now\}/);
  assert.match(priceReadModel, /p\.status = 'ACTIVE' AND p\.source_verified_at IS NOT NULL AND p\.source_verified_at <= \$\{now\}/);
  assert.match(route, /programIntakesTable\.sourceExpiresAt/);
  assert.match(priceReadModel, /p\.effective_from <= \$\{now\}/);
  assert.match(priceReadModel, /p\.effective_until IS NULL OR p\.effective_until >= \$\{now\}/);
  assert.match(priceReadModel, /p\.source_expires_at IS NULL OR p\.source_expires_at >= \$\{now\}/);
  assert.match(priceReadModel, /i\.id = p\.intake_id AND i\.program_id = p\.program_id/);
  assert.match(priceReadModel, /i\.status = 'ACTIVE'/);
  assert.match(priceReadModel, /i\.application_deadline_at IS NULL OR i\.application_deadline_at >= \$\{now\}/);
  assert.match(priceReadModel, /i\.source_expires_at IS NULL OR i\.source_expires_at >= \$\{now\}/);
  assert.match(priceReadModel, /\.slice\(0, 64\)/);
  assert.match(priceReadModel, /WHERE row_no <= 49/);
  assert.match(priceReadModel, /list\.length > 48/);
  assert.match(priceReadModel, /truncated: true/);
  assert.match(route, /programIntakesTable\.applicationDeadlineAt/);
  assert.match(renderReadModel, /programIntakesTable\.sourceExpiresAt/);
  assert.match(renderReadModel, /cacheGeneration/);
  assert.match(renderReadModel, /publicCatalogInvalidationBus, type PublicCatalogInvalidation/);
  assert.match(invalidationBus, /entityType\?: .*"catalog"/);
  assert.match(renderReadModel, /inFlight\.get\(key\) === pending/);
  assert.match(renderReadModel, /hasPublishedTranslation/);
  assert.match(renderReadModel, /sourceBlocks/);
  assert.match(renderReadModel, /alternatePaths: hasPublishedTranslation \? seoState\.alternates : \{\}/);
  assert.match(route, /sourceExpiresAt/);
  assert.match(route, /Content-Location/);
  assert.match(route, /readIndexableProgramIds/);
  assert.match(route, /PUBLIC_WEB_INTERNAL_LINK_MODE/);
  assert.match(route, /"PUBLISHED_INDEXABLE_ONLY"/);
  assert.match(route, /"LEGACY_UNGATED"/);
  assert.match(route, /programLinkPolicy/);
  assert.match(route, /select\(\{ degree: programsTable\.degree, count: sql<number>`count\(\*\)` \}\)/);
  assert.match(route, /groupBy\(programsTable\.degree\)/);
  assert.match(route, /degreeLevels: degreeRows/);
  assert.match(route, /degreeLevelCounts: degreeRows/);
  assert.match(route, /safePublicUniversityWebsite/);
  assert.match(route, /parsed\.protocol === "https:"/);
  assert.match(route, /readPublishedLocalizedEntity/);
  assert.match(route, /PUBLIC_UNIVERSITY_TRANSLATION_NOT_PUBLISHED/);
  assert.match(route, /contentPolicy/);
  assert.match(destinations, /returnedUniversities/);
  assert.match(destinations, /returnedPrograms/);
  assert.match(destinations, /PUBLIC_DESTINATION_ROUTE_INVALID/);
  assert.match(destinations, /resolvePublishedEntitySeoState/);
  assert.match(destinations, /Content-Location/);
  assert.match(destinations, /alternatePaths/);
  assert.match(destinations, /PUBLIC_WEB_INTERNAL_LINK_MODE/);
  assert.match(destinations, /readIndexableUniversityIds/);
  assert.match(destinations, /readIndexableProgramIds/);
  assert.match(destinations, /readPublishedLocalizedEntity/);
  assert.match(destinations, /resolvePublishedLocalizedDestinationRoute/);
  assert.match(destinations, /readPublishedLocalizedEntities/);
  assert.match(destinations, /\.limit\(64\)/);
  assert.match(destinations, /PUBLIC_DESTINATION_TRANSLATION_NOT_PUBLISHED/);
  assert.match(detailContent, /readRawHeroSrc/);
  assert.match(destinations, /contentPolicy/);
  assert.doesNotMatch(destinations, /\.limit\(50\)/);
  assert.match(publicWeb, /websiteBlogPostsTable\.status, "published"/);
  assert.match(publicWeb, /websiteBlogPostsTable\.publishedAt/);
  assert.match(publicWeb, /\.limit\(limit \+ 1\)/);
  assert.match(publicWeb, /Content-Location/);
  assert.match(publicWeb, /PUBLIC_GUIDE_ROUTE_INVALID/);
  assert.match(publicWeb, /related: rendered\.value\.relatedArticles/);
  assert.match(publicWeb, /PUBLISHED_INDEXABLE_ONLY/);
  assert.match(publicWeb, /PUBLIC_PAGE_ROUTE_INVALID/);
  assert.match(publicWeb, /PUBLIC_PAGE_NOT_FOUND/);
  assert.match(websiteAdmin, /translationsJson: page\.translationsJson/);
  assert.match(websiteAdmin, /updates\.status = "draft"/);
  assert.match(websiteAdmin, /const translationsJson = enrichWebsiteTranslationSeo\(req\.body\.translations \|\| \{\}, current\.translationsJson, current\.title\)/);
  assert.match(websiteAdmin, /\.set\(\{ translationsJson, status: "draft", publishedAt: null \}\)/);
  assert.match(websiteAdmin, /"catalog_grid"/);
  assert.match(websiteAdmin, /invalidatePublicCatalogRenderCache\(\{ entityType: "page"/);
  assert.match(websiteAdmin, /onMutation\?: \(id: number\) => void/);
  assert.match(websiteAdmin, /invalidatePagePublicationCaches/);
  assert.match(websiteAdmin, /invalidateArticlePublicationCaches/);
  assert.match(catalogAdmin, /invalidatePublicCatalogRenderCache\(\{ entityType: "catalog" \}\)/);
  assert.match(universitiesAdmin, /invalidatePublicCatalogRenderCache\(\{ entityType: "catalog" \}\)/);
  assert.match(catalogAdmin, /invalidatePublicWebDiscoveryCache\(\)/);
  assert.match(universitiesAdmin, /invalidatePublicWebDiscoveryCache\(\)/);
  assert.match(translationQueue, /completeProgramTranslation/);
  assert.match(translationQueue, /invalidatePublicCatalogRenderCache\(\{ entityType: "catalog" \}\)/);
  assert.match(translationQueue, /invalidatePublicWebDiscoveryCache\(\)/);
  const countCalls = (source: string, pattern: RegExp) => (source.match(pattern) || []).length;
  // Weather/external facts affect rendered content, not route identities or
  // published sitemap records. Every other catalog writer must invalidate both.
  const renderOnlyRoutes = new Set([
    "post /catalog/weather/refresh-due",
    "put /cities/:id/external-facts",
    "post /cities/:id/weather/refresh",
  ]);
  const observedRenderOnly = new Set<string>();
  for (const source of [catalogAdmin, universitiesAdmin]) {
    const ast = ts.createSourceFile("catalog-route.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let checkedRenderCalls = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "router"
          && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const routeKey = `${node.expression.name.text} ${node.arguments[0].text}`;
        const body = node.getText(ast);
        const renderCalls = countCalls(body, /invalidatePublicCatalogRenderCache\(\{ entityType: "catalog" \}\)/g);
        const discoveryCalls = countCalls(body, /invalidatePublicWebDiscoveryCache\(\)/g);
        checkedRenderCalls += renderCalls;
        if (renderCalls && renderOnlyRoutes.has(routeKey)) {
          observedRenderOnly.add(routeKey);
        } else if (renderCalls) {
          assert.equal(discoveryCalls, renderCalls, `${routeKey} must refresh public discovery with rendered content`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.equal(checkedRenderCalls, countCalls(source, /invalidatePublicCatalogRenderCache\(\{ entityType: "catalog" \}\)/g));
  }
  assert.deepEqual(observedRenderOnly, renderOnlyRoutes);
  assert.equal(
    countCalls(translationQueue, /invalidatePublicCatalogRenderCache\(\{ entityType: "catalog" \}\)/g),
    countCalls(translationQueue, /invalidatePublicWebDiscoveryCache\(\)/g),
  );
  assert.match(exampleEnvironment, /^PUBLIC_WEB_INTERNAL_LINK_MODE=off$/m);
  assert.doesNotMatch(publicWeb, /authorEmail|commission|serviceFee|contactPerson/i);
});

test("destination city cards use the canonical render model hero with a safe missing-content fallback", async () => {
  const source = read("../src/routes/destinations.ts");
  const ast = ts.createSourceFile("destinations.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const projections: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "cities"
        && node.initializer && node.initializer.getText(ast).includes("cityCards.map")) {
      projections.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(projections.length, 1, "the destination must have one city-card projection");
  const code = ts.transpileModule(`(async () => (${projections[0].getText(ast)}))`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const city = { id: 7, name: "TEST City", canonicalPath: "/en/cities/test-city-7", universityCount: 2 };
  const hero = { sections: [{ key: "hero", images: [{ src: " https://example.test/city.jpg " }] }] };
  for (const scenario of [
    { kind: "city_detail", editorial: hero, routeMatches: true, expected: "https://example.test/city.jpg" },
    { kind: "city_detail", editorial: { sections: [] }, routeMatches: true, expected: null },
    { kind: "university_detail", editorial: hero, routeMatches: true, expected: null },
    { kind: null, editorial: null, routeMatches: true, expected: null },
    { kind: null, editorial: null, routeMatches: false, expected: null },
  ]) {
    const matchedRoute = { entityType: "city", id: 7, locale: "en" };
    const lookups: unknown[] = [];
    const project = runInNewContext(code, {
      cityCards: [city],
      matchPublicCatalogRenderPath: (path: string) => {
        assert.equal(path, city.canonicalPath);
        return scenario.routeMatches ? matchedRoute : null;
      },
      getPublicCatalogRenderModel: async (route: unknown) => {
        assert.equal(route, matchedRoute);
        lookups.push(route);
        return scenario.kind ? { value: { kind: scenario.kind, editorial: scenario.editorial } } : null;
      },
    }, { timeout: 1_000 }) as () => Promise<unknown>;
    assert.deepEqual(structuredClone(await project()), [{ ...city, cardHeroImageUrl: scenario.expected }]);
    assert.equal(lookups.length, scenario.routeMatches ? 1 : 0);
  }
});
