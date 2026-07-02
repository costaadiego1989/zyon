/**
 * Tests for SafeJsonPre — verifies XSS safety and syntax highlighting.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SafeJsonPre } from "./NegotiationSimulatorTab.js";

describe("SafeJsonPre", () => {
  it("renders JSON without dangerouslySetInnerHTML", () => {
    const json = JSON.stringify({ key: "value", num: 42 }, null, 2);
    const html = renderToStaticMarkup(<SafeJsonPre json={json} />);
    expect(html).not.toContain("dangerouslySetInnerHTML");
    expect(html).toContain("<pre");
  });

  it("safely escapes XSS attempts as text content", () => {
    const malicious = JSON.stringify(
      { xss: "<script>alert(1)</script>", img: "<img onerror=alert(1)>" },
      null,
      2,
    );
    const html = renderToStaticMarkup(<SafeJsonPre json={malicious} />);
    // Script and img tags must be HTML-escaped, not rendered as elements
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("applies syntax highlighting classes for keys", () => {
    const json = JSON.stringify({ name: "test" }, null, 2);
    const html = renderToStaticMarkup(<SafeJsonPre json={json} />);
    expect(html).toContain('class="jk"');
  });

  it("applies syntax highlighting class for string values", () => {
    const json = JSON.stringify({ name: "test" }, null, 2);
    const html = renderToStaticMarkup(<SafeJsonPre json={json} />);
    expect(html).toContain('class="js"');
  });

  it("applies syntax highlighting class for numbers", () => {
    const json = JSON.stringify({ count: 42 }, null, 2);
    const html = renderToStaticMarkup(<SafeJsonPre json={json} />);
    expect(html).toContain('class="jn"');
  });

  it("applies syntax highlighting class for booleans and null", () => {
    const json = JSON.stringify({ active: true, empty: null }, null, 2);
    const html = renderToStaticMarkup(<SafeJsonPre json={json} />);
    expect(html).toContain('class="jb"');
  });

  it("renders without crashing on empty object", () => {
    const html = renderToStaticMarkup(<SafeJsonPre json="{}" />);
    expect(html).toContain("{");
    expect(html).toContain("}");
  });
});
