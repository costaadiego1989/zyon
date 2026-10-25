import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
const storefrontSource = path.resolve(root, "../../../src"), widgetSource = path.resolve(root, "../../../../widget_v2/src");
export default {
  root, esbuild: { jsx: "automatic" },
  resolve: { alias: [{ find: "@", replacement: storefrontSource, customResolver(source, importer) {
    const target = importer?.replaceAll("\\", "/").includes("/widget_v2/")
      ? path.resolve(widgetSource, path.relative(storefrontSource, source)) : source;
    return this.resolve(target, importer, { skipSelf: true });
  } }], dedupe: ["react", "react-dom"] },
  define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_BASE_URL: "/api/v1" }) },
  server: { host: "127.0.0.1", port: 5197, strictPort: true, fs: { allow: [path.resolve(root, "../../../../..")] } },
};
