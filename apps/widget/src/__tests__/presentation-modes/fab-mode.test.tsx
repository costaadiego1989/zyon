import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { WidgetFAB } from "../../components/presentation/WidgetFAB.js";

describe("WidgetFAB", () => {
  it("renders a button with class .zyon-presentation-fab", () => {
    const { container } = render(<WidgetFAB color="#000" position="bottom_right" onClick={() => {}} />);
    const btn = container.querySelector("button.zyon-presentation-fab");
    expect(btn).not.toBeNull();
  });

  it("is a 56px circle (width and height 56px)", () => {
    const { container } = render(<WidgetFAB color="#000" position="bottom_right" onClick={() => {}} />);
    const btn = container.querySelector("button.zyon-presentation-fab") as HTMLElement;
    expect(btn.style.width).toBe("56px");
    expect(btn.style.height).toBe("56px");
    expect(btn.style.borderRadius).toBe("50%");
  });

  it("applies fab color as background-color", () => {
    const { container } = render(<WidgetFAB color="#ff5500" position="bottom_right" onClick={() => {}} />);
    const btn = container.querySelector("button.zyon-presentation-fab") as HTMLElement;
    expect(btn.style.backgroundColor.toLowerCase()).toContain("rgb(255, 85, 0)");
  });

  it("applies position via inline style", () => {
    const { container } = render(<WidgetFAB color="#000" position="top_left" onClick={() => {}} />);
    const btn = container.querySelector("button.zyon-presentation-fab") as HTMLElement;
    expect(btn.style.position).toBe("fixed");
    expect(btn.style.top).toBe("24px");
    expect(btn.style.left).toBe("24px");
  });

  it("calls onClick when clicked (default open_widget action)", () => {
    const onClick = vi.fn();
    const { container } = render(<WidgetFAB color="#000" position="bottom_right" onClick={onClick} />);
    fireEvent.click(container.querySelector("button.zyon-presentation-fab")!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("calls onClick when clickAction is explicitly 'open_widget'", () => {
    const onClick = vi.fn();
    const { container } = render(
      <WidgetFAB
        color="#000"
        position="bottom_right"
        onClick={onClick}
        clickAction="open_widget"
        redirectUrl="https://example.com/cart"
      />
    );
    fireEvent.click(container.querySelector("button.zyon-presentation-fab")!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders badge with cart count when badgeCount > 0 and showCartBadge true", () => {
    const { container } = render(
      <WidgetFAB color="#000" position="bottom_right" onClick={() => {}} badgeCount={3} showCartBadge />
    );
    const badge = container.querySelector(".zyon-presentation-fab__badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("3");
  });

  it("hides badge when showCartBadge is false", () => {
    const { container } = render(
      <WidgetFAB color="#000" position="bottom_right" onClick={() => {}} badgeCount={3} showCartBadge={false} />
    );
    expect(container.querySelector(".zyon-presentation-fab__badge")).toBeNull();
  });

  it("hides badge when badgeCount is 0", () => {
    const { container } = render(
      <WidgetFAB color="#000" position="bottom_right" onClick={() => {}} badgeCount={0} showCartBadge />
    );
    expect(container.querySelector(".zyon-presentation-fab__badge")).toBeNull();
  });

  it("does not render before delay elapses when delayMs > 0", () => {
    vi.useFakeTimers();
    const { container } = render(
      <WidgetFAB color="#000" position="bottom_right" onClick={() => {}} delayMs={3000} />
    );
    expect(container.querySelector("button.zyon-presentation-fab")).toBeNull();
    vi.useRealTimers();
  });

  it("renders after delay elapses", () => {
    vi.useFakeTimers();
    const { container } = render(
      <WidgetFAB color="#000" position="bottom_right" onClick={() => {}} delayMs={2000} />
    );
    expect(container.querySelector("button.zyon-presentation-fab")).toBeNull();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(container.querySelector("button.zyon-presentation-fab")).not.toBeNull();
    vi.useRealTimers();
  });

  it("has pulse animation class on first appear", () => {
    const { container } = render(<WidgetFAB color="#000" position="bottom_right" onClick={() => {}} />);
    const btn = container.querySelector("button.zyon-presentation-fab") as HTMLElement;
    expect(btn.classList.contains("zyon-presentation-fab--pulse")).toBe(true);
  });

  it("has aria-label 'Abrir checkout'", () => {
    const { container } = render(<WidgetFAB color="#000" position="bottom_right" onClick={() => {}} />);
    expect(container.querySelector("button.zyon-presentation-fab")!.getAttribute("aria-label")).toBe("Abrir checkout");
  });
});

describe("WidgetFAB click actions", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    delete (window as any).location;
    (window as any).location = { href: "http://localhost/" };
    window.open = vi.fn();
  });

  afterEach(() => {
    (window as any).location = originalLocation;
    vi.restoreAllMocks();
  });

  it("redirects via window.location.href when clickAction is 'redirect_to_cart'", () => {
    const onClick = vi.fn();
    const { container } = render(
      <WidgetFAB
        color="#000"
        position="bottom_right"
        onClick={onClick}
        clickAction="redirect_to_cart"
        redirectUrl="/cart"
      />
    );
    fireEvent.click(container.querySelector("button.zyon-presentation-fab")!);
    expect(window.location.href).toBe("/cart");
    expect(onClick).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("falls back to '/' when redirect_to_cart has empty redirectUrl", () => {
    const onClick = vi.fn();
    const { container } = render(
      <WidgetFAB
        color="#000"
        position="bottom_right"
        onClick={onClick}
        clickAction="redirect_to_cart"
        redirectUrl=""
      />
    );
    fireEvent.click(container.querySelector("button.zyon-presentation-fab")!);
    expect(window.location.href).toBe("/");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("opens redirectUrl in a new tab when clickAction is 'open_new_tab'", () => {
    const onClick = vi.fn();
    const { container } = render(
      <WidgetFAB
        color="#000"
        position="bottom_right"
        onClick={onClick}
        clickAction="open_new_tab"
        redirectUrl="https://shop.example.com/checkout"
      />
    );
    fireEvent.click(container.querySelector("button.zyon-presentation-fab")!);
    expect(window.open).toHaveBeenCalledWith("https://shop.example.com/checkout", "_blank");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does nothing when clickAction is 'open_new_tab' but redirectUrl is empty", () => {
    const onClick = vi.fn();
    const { container } = render(
      <WidgetFAB
        color="#000"
        position="bottom_right"
        onClick={onClick}
        clickAction="open_new_tab"
        redirectUrl=""
      />
    );
    fireEvent.click(container.querySelector("button.zyon-presentation-fab")!);
    expect(window.open).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });
});
