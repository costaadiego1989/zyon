import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BusinessModeChoice, readSignupBusinessMode } from "./SignupWizard.js";

it("T10", () => {
  const html = renderToStaticMarkup(<BusinessModeChoice value="" onChange={() => {}} />);
  expect(html).toContain("O que sua empresa vende?");
  expect(html.match(/type="radio"/g)).toHaveLength(2);
  expect(html.match(/name="signup-business-mode"/g)).toHaveLength(2);
  expect(html).toContain('value="products"');
  expect(html).toContain('value="services"');
  expect(html).not.toContain("checked=");
  for (const mode of ["products", "services"] as const) {
    const selected = renderToStaticMarkup(<BusinessModeChoice value={mode} onChange={() => {}} />);
    expect(selected.match(/checked=""/g)).toHaveLength(1);
    expect(readSignupBusinessMode(mode)).toBe(mode);
  }
  for (const invalid of [null, "both", "service", ""]) expect(readSignupBusinessMode(invalid)).toBe("");
});
