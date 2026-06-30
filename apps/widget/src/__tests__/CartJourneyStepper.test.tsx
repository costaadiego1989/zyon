import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CartJourneyStepper } from "../components/checkout/CartJourneyStepper.js";

describe("CartJourneyStepper", () => {
  it("renders horizontal cart journey rail with track fill", () => {
    render(<CartJourneyStepper checkoutStage="data_collection" itemCount={2} />);
    expect(screen.getByLabelText("Jornada do carrinho")).toBeTruthy();
    expect(document.querySelector(".zyon-cart-journey--horizontal")).not.toBeNull();
    expect(document.querySelector(".zyon-cart-journey-track-fill")).not.toBeNull();
    expect(screen.getByText("Carrinho")).toBeTruthy();
    expect(screen.getByText("Dados")).toBeTruthy();
    expect(document.querySelector(".zyon-cart-journey-step.active .zyon-cart-journey-label")?.textContent).toBe("Dados");
  });

  it("starts at carrinho when there are no items", () => {
    render(<CartJourneyStepper checkoutStage="data_collection" itemCount={0} />);
    expect(document.querySelector(".zyon-cart-journey-step.active .zyon-cart-journey-label")?.textContent).toBe("Carrinho");
  });
});
