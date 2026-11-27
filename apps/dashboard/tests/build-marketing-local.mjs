import { spawnSync } from "node:child_process";
// Synthetic public values for a LOCAL bundle check. Never publish this artifact.
const result = spawnSync("pnpm", ["--filter", "@zyon/dashboard", "build"], {
  shell: process.platform === "win32",
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_API_BASE_URL: "https://local-validation.invalid",
    VITE_GOOGLE_CLIENT_ID: "local-validation.apps.googleusercontent.com",
    VITE_MICROSOFT_CLIENT_ID: "00000000-0000-0000-0000-000000000000",
    VITE_FACEBOOK_CLIENT_ID: "0",
    VITE_OAUTH_REDIRECT_URI:
      "https://local-validation.invalid/auth/oauth/callback",
    VITE_TURNSTILE_SITE_KEY: "local-validation",
    VITE_FACEBOOK_LOGIN_ENABLED: "false",
  },
});
process.exit(result.status ?? 1);
