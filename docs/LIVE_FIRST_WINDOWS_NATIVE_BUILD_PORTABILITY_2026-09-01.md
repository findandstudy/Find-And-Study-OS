# Live-first Windows native build portability - 1 September 2026

## Purpose

The live-first convergence branch had reintroduced override exclusions for the
four Windows x64 native packages required by the locked frontend toolchain.
TypeScript checks passed, but an actual Edcons production build failed because
Rollup's x64-MSVC binary was absent.

## Change

Only these Windows x64 packages were restored to the lock graph:

- `@rollup/rollup-win32-x64-msvc`;
- `@esbuild/win32-x64`;
- `@tailwindcss/oxide-win32-x64-msvc`;
- `lightningcss-win32-x64-msvc`.

Windows ARM64/IA32 support is not claimed. Foreign lockfiles remain preserved
and exact `pnpm@10.33.2` remains mandatory.

## Evidence

- `pnpm-workspace.yaml` and `pnpm-lock.yaml` are content-equivalent to the
  reviewed canonical portability candidate.
- Exact frozen install: pass; pnpm reported `+8` package nodes and linked `4`
  packages, with no lockfile rewrite required.
- Package-manager guard: `6/6`.
- API production build: pass.
- Edcons i18n check: `4,873` used keys, `6,106` English keys, `10` languages in
  sync.
- Edcons production build and sitemap generation: pass.
- Full workspace TypeScript check: pass.

No production dependency installation, build, deployment, VPS, GitHub or
`Next` state was changed.
