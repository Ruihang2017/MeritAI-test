// Builds the desktop app's main process: src/desktop/main.ts and the whole local server in one
// ES module (dist-desktop/main.mjs), so the installer needs no node_modules. Electron stays external.
// `npm run desktop` runs it; `npm run desktop:dist` then makes the Windows installer (release/).
import { build } from "esbuild";

await build({
  entryPoints: ["src/desktop/main.ts"],
  outfile: "dist-desktop/main.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["electron"],
  sourcemap: "linked",
  // CommonJS dependencies inside an ES module bundle need require, __filename and __dirname.
  banner: {
    js: [
      'import { createRequire as __cr } from "node:module";',
      'import { fileURLToPath as __fu } from "node:url";',
      'import { dirname as __dn } from "node:path";',
      "const require = __cr(import.meta.url);",
      "const __filename = __fu(import.meta.url);",
      "const __dirname = __dn(__filename);",
    ].join("\n"),
  },
  logLevel: "warning",
});
console.log("dist-desktop/main.mjs built");
