import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { InlineMode } from "../../components/presentation/InlineMode.js";

describe("InlineMode", () => {
  it("renders children inside a container that takes 100% of parent", () => {
    const { container } = render(
      <InlineMode>
        <div data-testid="content">content</div>
      </InlineMode>
    );
    const wrapper = container.querySelector(".zyon-presentation-inline") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.width).toBe("100%");
    expect(wrapper.style.height).toBe("100%");
    expect(wrapper.style.position).toBe("relative");
    expect(container.querySelector("[data-testid='content']")).not.toBeNull();
  });

  it("does not use fixed positioning", () => {
    const { container } = render(
      <InlineMode>
        <div>x</div>
      </InlineMode>
    );
    const wrapper = container.querySelector(".zyon-presentation-inline") as HTMLElement;
    expect(wrapper.style.position).not.toBe("fixed");
  });

  it("renders no border/box-shadow to blend into parent", () => {
    const { container } = render(
      <InlineMode>
        <div>x</div>
      </InlineMode>
    );
    const wrapper = container.querySelector(".zyon-presentation-inline") as HTMLElement;
    expect(wrapper.style.boxShadow).toBe("none");
  });
});