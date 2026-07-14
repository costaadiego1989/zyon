import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { WidgetBanner } from "../../components/presentation/WidgetBanner.js";

describe("WidgetBanner", () => {
  it("renders with class .zyon-presentation-banner", () => {
    const { container } = render(
      <WidgetBanner inviteText="Posso ajudar?" ctaLabel="Abrir chat" onClick={() => {}} onDismiss={() => {}} />
    );
    expect(container.querySelector(".zyon-presentation-banner")).not.toBeNull();
  });

  it("is fixed at bottom of page with 56px height and full width", () => {
    const { container } = render(
      <WidgetBanner inviteText="Posso ajudar?" ctaLabel="Abrir chat" onClick={() => {}} onDismiss={() => {}} />
    );
    const banner = container.querySelector(".zyon-presentation-banner") as HTMLElement;
    expect(banner.style.position).toBe("fixed");
    expect(banner.style.bottom).toBe("0px");
    expect(banner.style.left).toBe("0px");
    expect(banner.style.right).toBe("0px");
    expect(banner.style.height).toBe("56px");
  });

  it("renders invite text and CTA label", () => {
    const { getByText } = render(
      <WidgetBanner inviteText="Precisa de ajuda?" ctaLabel="Falar com agente" onClick={() => {}} onDismiss={() => {}} />
    );
    expect(getByText("Precisa de ajuda?")).not.toBeNull();
    expect(getByText("Falar com agente")).not.toBeNull();
  });

  it("calls onClick when CTA is clicked", () => {
    const onClick = vi.fn();
    const { container } = render(
      <WidgetBanner inviteText="Oi" ctaLabel="Abrir" onClick={onClick} onDismiss={() => {}} />
    );
    fireEvent.click(container.querySelector("button.zyon-presentation-banner__cta")!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when X is clicked", () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    const { container } = render(
      <WidgetBanner inviteText="Oi" ctaLabel="Abrir" onClick={onClick} onDismiss={onDismiss} />
    );
    fireEvent.click(container.querySelector("button.zyon-presentation-banner__dismiss")!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not render before delay", () => {
    vi.useFakeTimers();
    const { container } = render(
      <WidgetBanner inviteText="Oi" ctaLabel="Abrir" onClick={() => {}} onDismiss={() => {}} delayMs={4000} />
    );
    expect(container.querySelector(".zyon-presentation-banner")).toBeNull();
    vi.useRealTimers();
  });
});