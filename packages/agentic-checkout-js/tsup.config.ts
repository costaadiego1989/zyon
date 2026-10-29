import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "aacp-agentic-checkout.umd.min": "src/index.ts" },
  format: ["umd"],
  globalName: "AACPAgenticCheckout",
  minify: true,
  treeshake: true,
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: "dist-umd",
  platform: "browser",
  target: "es2022",
  outExtension() {
    return { js: ".cjs" };
  },
  banner: {
    js: "/* @zyon/agentic-checkout-js UMD — global AACPAgenticCheckout */"
  }
});
