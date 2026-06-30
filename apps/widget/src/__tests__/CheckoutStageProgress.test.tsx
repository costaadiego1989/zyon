import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CheckoutStageProgress } from "../components/checkout/CheckoutStageProgress.js";

describe("CheckoutStageProgress", () => {
  it("renders single track rail with progress fill", () => {
    render(<CheckoutStageProgress activeStage="data_collection" />);
    expect(screen.getByLabelText("Progresso do checkout")).toBeTruthy();
    expect(document.querySelector(".zyon-stage-progress-current")).not.toBeNull();
    expect(document.querySelector(".zyon-stage-progress-bar-fill")).toBeNull();
    expect(document.querySelector(".zyon-stage-progress-track-fill")).not.toBeNull();
  });

  it("fills track toward later stages", () => {
    render(<CheckoutStageProgress activeStage="shipping" />);
    const fill = document.querySelector(".zyon-stage-progress-track-fill") as HTMLElement | null;
    expect(fill?.style.width).toBe("37.5%");
  });

  it("shows visible fill on first stage", () => {
    render(<CheckoutStageProgress activeStage="data_collection" />);
    const fill = document.querySelector(".zyon-stage-progress-track-fill") as HTMLElement | null;
    expect(fill?.style.width).toBe("12.5%");
  });
});
