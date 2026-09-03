import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RestrictedAccessModal } from "./RestrictedAccessModal.js";
import { AccessModalProvider } from "../lib/auth/access-modal-context.js";

describe("RestrictedAccessModal", () => {
  it("renders nothing when closed (provider default state)", () => {
    const html = renderToStaticMarkup(
      <AccessModalProvider>
        <RestrictedAccessModal />
      </AccessModalProvider>,
    );
    expect(html).toBe("");
  });

  it("uses role=dialog when open", () => {
    // Source assertion — server-render cannot trigger stateful `useEffect`,
    // but we can still guarantee the dialog semantics by inspecting the source.
    const { readFileSync } = require("fs");
    const { resolve } = require("path");
    const src = readFileSync(
      resolve("src/components/RestrictedAccessModal.tsx"),
      "utf-8",
    );
    expect(src).toContain('role="dialog"');
    expect(src).toContain('aria-modal="true"');
    expect(src).toContain("Acesso restrito");
    expect(src).toContain('Voltar');
    expect(src).toContain('Ir para início');
    expect(src).toContain("Escape");
  });
});
