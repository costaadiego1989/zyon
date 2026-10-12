import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
export default { root, esbuild: { jsx: "automatic" },
  cacheDir: path.resolve(root, "../../../node_modules/.vite/orders-guards"),
  resolve: { alias: { "@": path.resolve(root, "../../../src") }, dedupe: ["react", "react-dom"] },
  define: { "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify("/api") },
  server: { host: "127.0.0.1", port: 5201, strictPort: true, fs: { allow: [path.resolve(root, "../../../../..")] } },
};
