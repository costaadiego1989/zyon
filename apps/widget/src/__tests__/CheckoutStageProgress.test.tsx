import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CheckoutStageProgress } from "../components/checkout/CheckoutStageProgress.js";

describe("CheckoutStageProgress", () => {
  it("renders continuous track rail with summary bar fill", () => {
    render(<CheckoutStageProgress activeStage="data_collection" />);
    expect(screen.getByLabelText("Progresso do checkout")).toBeTruthy();
    expect(document.querySelector(".aacp-stage-progress-head--indented")).not.toBeNull();
    expect(document.querySelector(".aacp-stage-progress-bar-fill")).not.toBeNull();
    expect(document.querySelector(".aacp-stage-progress-track-fill")).not.toBeNull();
  });

  it("fills track toward later stages", () => {
    render(<CheckoutStageProgress activeStage="shipping" />);
    const fill = document.querySelector(".aacp-stage-progress-track-fill") as HTMLElement | null;
    expect(fill?.style.width).toMatch(/^33\.33/);
  });
});
