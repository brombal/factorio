import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Use relative asset URLs so the build works under GitHub Pages' /<repo>/ path.
  base: "./",
  plugins: [react({ jsxImportSource: "@emotion/react" })],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    host: true,
    // Allow the dev server to be reached through a quick cloudflared tunnel.
    allowedHosts: [".trycloudflare.com"],
  },
});
