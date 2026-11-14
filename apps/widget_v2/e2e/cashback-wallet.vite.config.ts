import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, ".."),
  cacheDir: resolve(__dirname, "../node_modules/.vite-cashback-wallet"),
  plugins: [react()],
  define: { "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify("") },
  resolve: {
    alias: [{ find: "@/lib/buyer-auth", replacement: resolve(__dirname, "../../storefront/src/lib/buyer-auth.ts") }, { find: "@", replacement: resolve(__dirname, "../src") }],
    dedupe: ["react", "react-dom"],
  },
  server: { host: "127.0.0.1", port: 5184, strictPort: true, fs: { allow: [resolve(__dirname, "../../..")] } },
});
