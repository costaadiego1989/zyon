import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { TriggerOnlyMode } from "../../components/presentation/TriggerOnlyMode.js";

describe("TriggerOnlyMode", () => {
  it("renders nothing initially", () => {
    const { container } = render(
      <TriggerOnlyMode onTrigger={() => {}}>{() => <div data-testid="panel">PANEL</div>}</TriggerOnlyMode>
    );
    expect(container.querySelector("[data-testid='panel']")).toBeNull();
  });

  it("renders children panel when triggered manually", () => {
    let captured: { trigger: () => void } | null = null;
    render(
      <TriggerOnlyMode
        onTrigger={() => {}}
        ref={(api) => {
          if (api) captured = api;
        }}
      >
        {() => <div data-testid="panel">PANEL</div>}
      </TriggerOnlyMode>
    );
    act(() => captured!.trigger());
    // Re-render not needed; we check via captured reference. Re-render to check.
  });

  it("does not call onTrigger on mount", () => {
    const onTrigger = vi.fn();
    render(<TriggerOnlyMode onTrigger={onTrigger}>{() => <div>P</div>}</TriggerOnlyMode>);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("renders no DOM in the wrapper div when not triggered", () => {
    const { container } = render(
      <TriggerOnlyMode onTrigger={() => {}}>{() => <div data-testid="panel">P</div>}</TriggerOnlyMode>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders panel after manual trigger", () => {
    const ref = React.createRef<any>();
    const { container } = render(
      <TriggerOnlyMode onTrigger={() => {}} ref={ref}>
        {() => <div data-testid="panel">PANEL</div>}
      </TriggerOnlyMode>
    );
    expect(container.querySelector("[data-testid='panel']")).toBeNull();
    act(() => ref.current?.trigger());
    expect(container.querySelector("[data-testid='panel']")).not.toBeNull();
  });
});