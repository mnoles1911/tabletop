import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Vite serves the React client. In dev it proxies /api to the Express
// game server (see src/server/index.ts) so the play-by-cloud sync layer
// and the UI run side by side under `npm run dev`.
export default defineConfig({
  root: "src/client",
  plugins: [react()],
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("./src/engine", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
});
