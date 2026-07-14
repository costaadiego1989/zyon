import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { WidgetMiniCard } from "../../components/presentation/WidgetMiniCard.js";

describe("WidgetMiniCard", () => {
  it("renders with class .zyon-presentation-mini-card", () => {
    const { container } = render(
      <WidgetMiniCard inviteText="Posso ajudar?" onClick={() => {}} onDismiss={() => {}} />
    );
    expect(container.querySelector(".zyon-presentation-mini-card")).not.toBeNull();
  });

  it("is a 240x64 card", () => {
    const { container } = render(
      <WidgetMiniCard inviteText="Posso ajudar?" onClick={() => {}} onDismiss={() => {}} />
    );
    const card = container.querySelector(".zyon-presentation-mini-card") as HTMLElement;
    expect(card.style.width).toBe("240px");
    expect(card.style.height).toBe("64px");
  });

  it("renders invite text", () => {
    const { getByText } = render(
      <WidgetMiniCard inviteText="Oi! Vamos finalizar?" onClick={() => {}} onDismiss={() => {}} />
    );
    expect(getByText("Oi! Vamos finalizar?")).not.toBeNull();
  });

  it("calls onClick when card is clicked", () => {
    const onClick = vi.fn();
    const { container } = render(
      <WidgetMiniCard inviteText="Oi" onClick={onClick} onDismiss={() => {}} />
    );
    fireEvent.click(container.querySelector(".zyon-presentation-mini-card")!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders dismiss button", () => {
    const { container } = render(
      <WidgetMiniCard inviteText="Oi" onClick={() => {}} onDismiss={() => {}} />
    );
    expect(container.querySelector("button.zyon-presentation-mini-card__dismiss")).not.toBeNull();
  });

  it("calls onDismiss when X is clicked, not onClick", () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    const { container } = render(
      <WidgetMiniCard inviteText="Oi" onClick={onClick} onDismiss={onDismiss} />
    );
    fireEvent.click(container.querySelector("button.zyon-presentation-mini-card__dismiss")!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("has aria-label 'Fechar' on dismiss button", () => {
    const { container } = render(
      <WidgetMiniCard inviteText="Oi" onClick={() => {}} onDismiss={() => {}} />
    );
    expect(
      container.querySelector("button.zyon-presentation-mini-card__dismiss")!.getAttribute("aria-label")
    ).toBe("Fechar");
  });

  it("does not render before delay", () => {
    vi.useFakeTimers();
    const { container } = render(
      <WidgetMiniCard inviteText="Oi" onClick={() => {}} onDismiss={() => {}} delayMs={5000} />
    );
    expect(container.querySelector(".zyon-presentation-mini-card")).toBeNull();
    vi.useRealTimers();
  });
});