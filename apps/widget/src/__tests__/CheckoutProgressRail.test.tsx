import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CheckoutProgressRail } from "../components/checkout/CheckoutProgressRail.js";

describe("CheckoutProgressRail", () => {
  it("renders connected checkout stages with progress fill", () => {
    render(<CheckoutProgressRail activeStage="shipping" />);
    expect(screen.getByLabelText("Progresso do checkout")).toBeTruthy();
    expect(screen.getByText("Cadastro")).toBeTruthy();
    expect(screen.getByText("Entrega")).toBeTruthy();
    expect(screen.getByText("Pagamento")).toBeTruthy();
    const fill = document.querySelector(".zyon-progress-line-fill") as HTMLElement | null;
    expect(fill).not.toBeNull();
    expect(fill?.style.width).toMatch(/^33\.33/);
  });
});
