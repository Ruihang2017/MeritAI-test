import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: `npm run ui:dev` runs the local server on 5174 and this dev server on 5173 (proxying /ws).
// The dev server may serve only web/ (the shared protocol types are compiled in, not fetched):
// the project root holds the ChatGPT login (codex_home), memory and workspaces.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/ws": { target: "ws://127.0.0.1:5174", ws: true } },
    fs: {
      strict: true,
      allow: [import.meta.dirname, `${import.meta.dirname}/../node_modules`],
      deny: [".env", ".env.*", "*.sqlite", "*.sqlite-*", "**/codex_home/**", "**/memory*/**", "**/files/**", "**/workspace*/**", "auth.json"],
    },
    headers: { "Content-Security-Policy": "default-src 'self'; connect-src 'self' ws://127.0.0.1:5173; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'" },
  },
  // One bundle is fine for a local app served from this computer (about 0.5 MB, 150 kB gzipped).
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 800 },
});
