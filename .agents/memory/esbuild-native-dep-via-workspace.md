---
name: Native dep pulled in via a workspace package crashes the prod bundle
description: Why a native module (sharp) used only through a @workspace/* lib must be a DIRECT dep of the bundled artifact.
---

# Native dep via workspace package → prod boot crash

api-server's `build.ts` (esbuild) marks a dependency `external` ONLY if it appears
in api-server's own `package.json`; everything else — including all `@workspace/*`
packages — is BUNDLED. So esbuild follows into a workspace lib's source and tries
to bundle that lib's transitive deps too.

**Problem:** a NATIVE module (e.g. `sharp`) reached only transitively through a
workspace package (`@workspace/portal-runner`) is not in api-server's deps, so it
is neither in the esbuild `external` list nor installed into
`artifacts/api-server/node_modules`. esbuild can't bundle a native `.node`
binary, so at boot `require("sharp")` throws `MODULE_NOT_FOUND`
(`node:internal/modules/cjs/loader`), the process never opens its port, and every
`/api` healthcheck returns 500 → deployment fails to publish. Dev (tsx, no
bundling) hides this entirely.

**Rule:** any native / non-bundleable module used anywhere in the api-server
dependency graph (even transitively via a workspace lib) MUST be added as a
DIRECT dependency of `artifacts/api-server/package.json`. That single change both
puts it in the esbuild `external` list (so it's left as a runtime `require`) AND
makes pnpm install it where Node can resolve it from `dist/index.cjs`. Same
pattern as the existing `playwright-core` / `pdf-lib` deps.

**How to verify after the fix:** prod build succeeds; `rg 'require("sharp")'
dist/index.cjs` shows the external require; `require.resolve('sharp', {paths:
['artifacts/api-server/dist']})` resolves; and a quick `require('sharp')(...)
.jpeg().toBuffer()` confirms the native binary loads.
