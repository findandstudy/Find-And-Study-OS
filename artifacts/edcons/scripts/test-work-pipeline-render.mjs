import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const project = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vite"));
const { build } = viteRequire("esbuild");
const tempRoot = resolve(tmpdir());
const dir = await mkdtemp(join(tempRoot, "fas-pipeline-render-"));
try {
  const output = join(dir, "render.mjs");
  await build({
    entryPoints: [
      resolve(
        project,
        "artifacts/edcons/scripts/test-work-pipeline-render.tsx",
      ),
    ],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    jsx: "automatic",
    logLevel: "error",
    tsconfig: resolve(project, "artifacts/edcons/tsconfig.json"),
    define: {
      "import.meta.env": JSON.stringify({
        BASE_URL: "",
        DEV: false,
        MODE: "test",
      }),
    },
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  });
  await import(pathToFileURL(output).href);
} finally {
  if (
    !resolve(dir).startsWith(tempRoot + sep) ||
    !basename(dir).startsWith("fas-pipeline-render-")
  )
    throw new Error("Unexpected render-test cleanup target");
  await rm(dir, { recursive: true, force: true });
}
