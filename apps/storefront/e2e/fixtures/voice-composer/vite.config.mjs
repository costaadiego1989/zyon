import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
const storefront = path.resolve(root, "../../../src");
const widget = path.resolve(root, "../../../../widget_v2/src");
export default {
  root, esbuild: { jsx: "automatic" }, cacheDir: path.resolve(root, "../../../node_modules/.vite/voice-composer"),
  plugins: [{ name: "checkout-source-alias", enforce: "pre", resolveId(source, importer) {
    if (source.startsWith("@/")) return this.resolve(path.resolve(importer?.replaceAll("\\", "/").includes("/widget_v2/") ? widget : storefront, source.slice(2)), importer, { skipSelf: true });
  } }],
  resolve: { dedupe: ["react", "react-dom"] },
  define: { "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify("/api"), "process.env": "{}" },
  server: { host: "127.0.0.1", port: 5203, strictPort: true, fs: { allow: [path.resolve(root, "../../../../..")] } },
};
