import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
export default {
  root, esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(root, "../../../src") }, dedupe: ["react", "react-dom"] },
  define: { "process.env": "{}" },
  server: { host: "127.0.0.1", port: 5186, strictPort: true, fs: { allow: [path.resolve(root, "../../../../..")] } },
};
