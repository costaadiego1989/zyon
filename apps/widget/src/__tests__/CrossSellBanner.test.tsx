import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { CrossSellBanner } from "../components/checkout/CrossSellBanner.js";
import type { SuggestedProduct } from "@aacp/shared-types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WALLET: SuggestedProduct = {
  sku: "wallet-001",
  name: "Carteira Slim RFID",
  unit_price: 129.9,
  image_url: "https://cdn.example.com/wallet.jpg"
};

const BELT: SuggestedProduct = {
  sku: "belt-002",
  name: "Cinto de Couro Genuíno",
  unit_price: 89.9
};

// ─────────────────────────────────────────────────────────────────────────────

describe("CrossSellBanner", () => {
  // ── Rendering ───────────────────────────────────────────────────────────────

  it("renders nothing when products list is empty", () => {
    const { container } = render(
      <CrossSellBanner products={[]} onAdd={vi.fn()} onDismiss={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a card for each suggested product", () => {
    const { getAllByRole } = render(
      <CrossSellBanner products={[WALLET, BELT]} onAdd={vi.fn()} onDismiss={vi.fn()} />
    );
    const cards = getAllByRole("article");
    expect(cards).toHaveLength(2);
  });

  it("renders product name and formatted price", () => {
    const { getByText } = render(
      <CrossSellBanner products={[WALLET]} onAdd={vi.fn()} onDismiss={vi.fn()} />
    );
    expect(getByText("Carteira Slim RFID")).not.toBeNull();
    expect(getByText(/129/)).not.toBeNull();
  });

  it("renders product image when image_url provided", () => {
    const { getByRole } = render(
      <CrossSellBanner products={[WALLET]} onAdd={vi.fn()} onDismiss={vi.fn()} />
    );
    const img = getByRole("img", { name: "Carteira Slim RFID" });
    expect((img as HTMLImageElement).src).toContain("wallet.jpg");
  });

  it("renders placeholder icon when no image_url", () => {
    const { container } = render(
      <CrossSellBanner products={[BELT]} onAdd={vi.fn()} onDismiss={vi.fn()} />
    );
    expect(container.querySelector(".aacp-cross-sell-thumb svg")).not.toBeNull();
    expect(container.querySelector(".aacp-cross-sell-thumb img")).toBeNull();
  });

  it("renders an Adicionar button for each product", () => {
    const { getAllByRole } = render(
      <CrossSellBanner products={[WALLET, BELT]} onAdd={vi.fn()} onDismiss={vi.fn()} />
    );
    const addBtns = getAllByRole("button", { name: /Adicionar/i });
    expect(addBtns).toHaveLength(2);
  });

  it("renders a dismiss button", () => {
    const { getByLabelText } = render(
      <CrossSellBanner products={[WALLET]} onAdd={vi.fn()} onDismiss={vi.fn()} />
    );
    expect(getByLabelText("Fechar sugestões")).not.toBeNull();
  });

  // ── Interactions ─────────────────────────────────────────────────────────────

  it("calls onAdd with product when Adicionar is clicked", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const { getAllByRole } = render(
      <CrossSellBanner products={[WALLET, BELT]} onAdd={onAdd} onDismiss={vi.fn()} />
    );
    const [firstBtn] = getAllByRole("button", { name: /Adicionar/i });
    await act(async () => { fireEvent.click(firstBtn); });
    expect(onAdd).toHaveBeenCalledWith(WALLET);
  });

  it("disables Adicionar button while onAdd is pending", async () => {
    let resolve!: () => void;
    const onAdd = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const { getAllByRole } = render(
      <CrossSellBanner products={[WALLET]} onAdd={onAdd} onDismiss={vi.fn()} />
    );
    const [btn] = getAllByRole("button", { name: /Adicionar/i });
    fireEvent.click(btn);
    await waitFor(() => expect(btn.hasAttribute("disabled")).toBe(true));
    await act(async () => { resolve(); });
  });

  it("shows 'Adicionado!' label after successful add", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const { getAllByRole, getByText } = render(
      <CrossSellBanner products={[WALLET]} onAdd={onAdd} onDismiss={vi.fn()} />
    );
    const [btn] = getAllByRole("button", { name: /Adicionar/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => {
      expect(getByText("Adicionado!")).not.toBeNull();
    });
  });

  it("calls onDismiss when dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    const { getByLabelText } = render(
      <CrossSellBanner products={[WALLET]} onAdd={vi.fn()} onDismiss={onDismiss} />
    );
    fireEvent.click(getByLabelText("Fechar sugestões"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("renders variant text when product has variant", () => {
    const product: SuggestedProduct = { ...WALLET, variant: "Preto · Couro" };
    const { getByText } = render(
      <CrossSellBanner products={[product]} onAdd={vi.fn()} onDismiss={vi.fn()} />
    );
    expect(getByText("Preto · Couro")).not.toBeNull();
  });
});
