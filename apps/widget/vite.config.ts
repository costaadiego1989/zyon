import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import tailwindConfig from "./tailwind.config.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  /** Evita servir pasta errada quando o comando é corrido com cwd inesperado. */
  root: resolve(__dirname),
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss(tailwindConfig), autoprefixer()]
    }
  },
  server: {
    host: true,
    port: 5173,
    /** Se outro projeto já usa 5173, o dev falha (não há “mudança silenciosa” de porta nem confusão com outro Vite). */
    strictPort: true
  },
  define: {
    "process.env.VITEST": "undefined",
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/main.tsx"),
      name: "AacpCheckoutWidget",
      /** ES para bundlers; IIFE para `<script src="…" defer>` em sites terceiros. */
      formats: ["es", "iife"],
      fileName: (format) =>
        format === "es" ? "aacp-checkout-widget.js" : "aacp-checkout-widget.iife.js"
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
});
