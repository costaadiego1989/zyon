import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FREE_TRIAL_DAYS } from "@zyon/shared-types";
import { AuthExperience } from "./SignupExperience.js";

describe("AuthExperience trial copy", () => {
  it.each(["signup", "login"] as const)("uses the catalog trial duration in %s without promising waived fees", mode => {
    const html = renderToStaticMarkup(
      <AuthExperience mode={mode} busy={false} onSwitchMode={() => {}}>
        <h2>Acesso à loja</h2>
      </AuthExperience>,
    );
    expect(html).toContain(`Comece no Free por ${FREE_TRIAL_DAYS} dias.`);
    expect(html).not.toContain("14 dias");
    expect(html).not.toContain("sem taxa");
    expect(html).toContain('src="/logo-zyon.png"');
  });
});
