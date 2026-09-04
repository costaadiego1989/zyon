import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { act } from "react";
import { PresentationModeResolver } from "../../components/presentation/PresentationModeResolver.js";

describe("PresentationModeResolver", () => {
  it("renders FAB when mode is 'fab'", () => {
    const { container } = render(
      <PresentationModeResolver
        config={{ presentationMode: "fab", position: "bottom_right", fabColor: "#000", inviteText: "Oi", showCartBadge: true, accentColor: "#3b82f6" }}
        renderPanel={() => <div data-testid="panel" />}
      />
    );
    expect(container.querySelector("button.zyon-presentation-fab")).not.toBeNull();
  });

  it("renders MiniCard when mode is 'mini_card'", () => {
    const { container } = render(
      <PresentationModeResolver
        config={{ presentationMode: "mini_card", position: "bottom_right", fabColor: "#000", inviteText: "Oi", showCartBadge: true, accentColor: "#3b82f6" }}
        renderPanel={() => <div data-testid="panel" />}
      />
    );
    expect(container.querySelector(".zyon-presentation-mini-card")).not.toBeNull();
  });

  it("renders Banner when mode is 'bottom_banner'", () => {
    const { container } = render(
      <PresentationModeResolver
        config={{ presentationMode: "bottom_banner", position: "bottom_right", fabColor: "#000", inviteText: "Oi", showCartBadge: true, accentColor: "#3b82f6" }}
        renderPanel={() => <div data-testid="panel" />}
      />
    );
    expect(container.querySelector(".zyon-presentation-banner")).not.toBeNull();
  });

  it("renders nothing for trigger_only when not triggered", () => {
    const { container } = render(
      <PresentationModeResolver
        config={{ presentationMode: "trigger_only", position: "bottom_right", fabColor: "#000", inviteText: "Oi", showCartBadge: true, accentColor: "#3b82f6" }}
        renderPanel={() => <div data-testid="panel" />}
      />
    );
    expect(container.querySelector("button.zyon-presentation-fab")).toBeNull();
    expect(container.querySelector(".zyon-presentation-mini-card")).toBeNull();
    expect(container.querySelector(".zyon-presentation-banner")).toBeNull();
  });

  it("renders Inline wrapper when mode is 'inline'", () => {
    const { container } = render(
      <PresentationModeResolver
        config={{ presentationMode: "inline", position: "bottom_right", fabColor: "#000", inviteText: "Oi", showCartBadge: true, accentColor: "#3b82f6" }}
        renderPanel={() => <div data-testid="panel-inline" />}
      />
    );
    expect(container.querySelector(".zyon-presentation-inline")).not.toBeNull();
    expect(container.querySelector("[data-testid='panel-inline']")).not.toBeNull();
  });

  it("defaults to FAB when presentationMode is missing", () => {
    const { container } = render(
      <PresentationModeResolver
        config={{ position: "bottom_right", fabColor: "#000", inviteText: "Oi", showCartBadge: true, accentColor: "#3b82f6" }}
        renderPanel={() => <div data-testid="panel" />}
      />
    );
    expect(container.querySelector("button.zyon-presentation-fab")).not.toBeNull();
  });

  it("FAB click triggers renderPanel (panel shown)", () => {
    const { container, queryByTestId } = render(
      <PresentationModeResolver
        config={{ presentationMode: "fab", position: "bottom_right", fabColor: "#000", inviteText: "Oi", showCartBadge: true, accentColor: "#3b82f6" }}
        renderPanel={() => <div data-testid="panel" />}
      />
    );
    expect(queryByTestId("panel")).toBeNull();
    const fab = container.querySelector("button.zyon-presentation-fab") as HTMLButtonElement;
    act(() => { fab?.click(); });
    expect(queryByTestId("panel")).not.toBeNull();
  });
});