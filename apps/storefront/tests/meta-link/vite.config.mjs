import { fileURLToPath } from "node:url";
export default {
  root: fileURLToPath(new URL("./", import.meta.url)),
  envDir: false,
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  define: { "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify("/api/v1") },
  server: { fs: { allow: [fileURLToPath(new URL("../../../../", import.meta.url))] } },
};
