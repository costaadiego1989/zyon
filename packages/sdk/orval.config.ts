import { defineConfig } from "orval";

export default defineConfig({
  aacp: {
    input: {
      target: "http://localhost:3009/openapi.json",
    },
    output: {
      target: "./src/generated",
      client: "axios",
      mode: "tags-split",
      clean: true,
      override: {
        mutator: {
          path: "./src/client.ts",
          name: "customInstance",
        },
      },
    },
  },
});
