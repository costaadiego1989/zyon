import type { AuthMode } from "./AuthScreen.js";

export function authModeFromUrl(href: string): AuthMode {
  const url = new URL(href);
  if (url.pathname.includes("reset-password") && url.searchParams.get("token")) return "reset";
  const mode = url.searchParams.get("mode");
  if (mode === "signin" || mode === "login") return "login";
  if (mode === "signup" || mode === "forgot") return mode;
  return url.pathname === "/" ? "signup" : "login";
}

export function authUrlForMode(href: string, mode: AuthMode): string {
  if (mode === "reset") return href;
  const url = new URL(href);
  url.pathname = "/";
  url.hash = "";
  for (const key of ["token", "code", "state", "error", "error_description"]) url.searchParams.delete(key);
  url.searchParams.set("mode", mode === "login" ? "signin" : mode);
  return url.href;
}

