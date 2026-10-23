import { describe, expect, it } from "vitest";
import { authModeFromUrl, authUrlForMode } from "./auth-navigation.js";

const origin = "https://app.example.test";
describe("authentication navigation", () => {
  it.each(["signin", "login"])("accepts %s links as login", mode => {
    expect(authModeFromUrl(`${origin}/?mode=${mode}`)).toBe("login");
  });
  it("preserves signup and password reset entry points", () => {
    expect(authModeFromUrl(`${origin}/?mode=signup`)).toBe("signup");
    expect(authModeFromUrl(`${origin}/`)).toBe("signup");
    expect(authModeFromUrl(`${origin}/reset-password?token=synthetic`)).toBe("reset");
    expect(authModeFromUrl(`${origin}/?mode=forgot`)).toBe("forgot");
    expect(authModeFromUrl(`${origin}/?mode=reset`)).toBe("signup");
  });
  it("switches to canonical signin while preserving benign subscription parameters", () => {
    const url = new URL(authUrlForMode(`${origin}/?mode=signup&plan=growth&utm_source=test`, "login"));
    expect(url.searchParams.get("mode")).toBe("signin");
    expect(url.searchParams.get("plan")).toBe("growth");
    expect(url.searchParams.get("utm_source")).toBe("test");
    expect(url.origin).toBe(origin);
  });
  it("drops old credential parameters and recovery routes on an explicit mode switch", () => {
    const url = new URL(authUrlForMode(`${origin}/reset-password?token=synthetic&code=old&state=old&error=old&error_description=old&plan=free#token=old`, "signup"));
    expect(url.pathname).toBe("/");
    expect(url.hash).toBe("");
    expect([...url.searchParams.keys()]).toEqual(["plan", "mode"]);
    expect(url.searchParams.get("mode")).toBe("signup");
  });
  it("never manufactures a reset link or loses its proof when staying on reset", () => {
    const current = `${origin}/reset-password?token=synthetic`;
    expect(authUrlForMode(current, "reset")).toBe(current);
  });
});

