import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: `npm run ui:dev` runs the local server on 5174 and this dev server on 5173 (proxying /ws).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/ws": { target: "ws://127.0.0.1:5174", ws: true } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
