import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({ root: resolve(__dirname, "fixtures"), plugins: [react()],
  server: { host: "127.0.0.1", port: 18175, strictPort: true, fs: { allow: [resolve(__dirname, "../..")] } } });
