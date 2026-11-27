import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ["e2e/fixtures/platform-support.html"] },
  server: { host: "127.0.0.1", port: 17441, strictPort: true },
});
