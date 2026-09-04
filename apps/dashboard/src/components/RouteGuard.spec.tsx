import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteGuard } from "./RouteGuard.js";
import { AccessModalProvider } from "../lib/auth/access-modal-context.js";

const me = (role: "OWNER" | "ADMIN" | "STAFF") =>
  ({ id: "mrc_1", name: "X", plan: "BOTH", role, user_id: "usr_1" } as const);

describe("RouteGuard", () => {
  it("renders children when role can access", () => {
    const html = renderToStaticMarkup(
      <AccessModalProvider>
        <RouteGuard me={me("OWNER")} require="catalog">
          <div data-testid="child">OK</div>
        </RouteGuard>
      </AccessModalProvider>,
    );
    expect(html).toContain('data-testid="child"');
  });

  it("blocks children when role cannot access", () => {
    const html = renderToStaticMarkup(
      <AccessModalProvider>
        <RouteGuard me={me("STAFF")} require="catalog">
          <div data-testid="child">Should not appear</div>
        </RouteGuard>
      </AccessModalProvider>,
    );
    expect(html).not.toContain('data-testid="child"');
  });

  it("blocks children for ADMIN on OWNER-only tabs", () => {
    const html = renderToStaticMarkup(
      <AccessModalProvider>
        <RouteGuard me={me("ADMIN")} require="billing-plans">
          <div data-testid="child">Should not appear</div>
        </RouteGuard>
      </AccessModalProvider>,
    );
    expect(html).not.toContain('data-testid="child"');
  });
});
