import { defineConfig } from "orval";

export default defineConfig({
  aacp: {
    input: {
      target: process.env.AACP_SPEC_URL || "./openapi.json",
      validation: false,
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
