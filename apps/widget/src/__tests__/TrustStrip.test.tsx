import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrustStrip } from "../components/checkout/TrustStrip.js";

describe("TrustStrip", () => {
  it("renders default security seals", () => {
    render(<TrustStrip />);
    expect(screen.getByLabelText("Garantias e segurança")).toBeTruthy();
    expect(screen.getByText("Checkout criptografado")).toBeTruthy();
    expect(screen.getByText("Pagamento seguro")).toBeTruthy();
    expect(screen.getByText("Brasil · BRL")).toBeTruthy();
  });

  it("renders custom merchant badges", () => {
    render(<TrustStrip items={["Entrega garantida"]} />);
    expect(screen.getByText("Entrega garantida")).toBeTruthy();
  });
});
