import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "playwright-report/**", "test-results/**"] },
  // Existing Control sources retain syntax checking. The new feature and its
  // tests adopt recommended rules without rewriting the copied admin baseline.
  { files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } } },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ["src/lib/prospecting-api*.ts", "src/ui/prospecting/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "*.config.ts"] })),
);
