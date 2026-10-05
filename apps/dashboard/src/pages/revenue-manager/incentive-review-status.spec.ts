import { describe, expect, it } from "vitest";
import { incentiveReviewStatusLabel } from "./incentive-review-status.js";

describe("the selected commercial strategy's main status", () => {
  it("shows the financial refusal instead of the separate communication's pending state", () => {
    expect(incentiveReviewStatusLabel("rejected")).toBe("Recusada");
  });
  it("distinguishes recorded approval, scheduled execution and active execution", () => {
    expect(incentiveReviewStatusLabel("approved_awaiting_activation")).toBe("Aprovada, aguardando ativação");
    expect(incentiveReviewStatusLabel("approved_awaiting_activation", "scheduled")).toBe("Aprovada, aguardando início");
    expect(incentiveReviewStatusLabel("approved_awaiting_activation", "active")).toBe("Em teste");
    expect(incentiveReviewStatusLabel("approved_awaiting_activation", "active", true)).toBe("Aprovação registrada");
  });
  it("reflects interruptions and changed conditions without claiming the strategy is active", () => {
    expect(incentiveReviewStatusLabel("approval_invalidated", "suspended")).toBe("Novas ofertas suspensas");
    expect(incentiveReviewStatusLabel("approved_awaiting_activation", "ended")).toBe("Teste encerrado");
    expect(incentiveReviewStatusLabel("withdrawn", "withdrawn")).toBe("Teste interrompido");
    expect(incentiveReviewStatusLabel("approval_invalidated")).toBe("Condições da aprovação mudaram");
  });
  it.each([undefined, "future_status", "unavailable"])("does not invent a ready state for %s", status => {
    expect(incentiveReviewStatusLabel(status)).toBe("Decisão indisponível");
  });
  it("rejects contradictory execution without an approval", () => {
    expect(incentiveReviewStatusLabel("rejected", "active")).toBe("Decisão indisponível");
    expect(incentiveReviewStatusLabel("awaiting_review", "active")).toBe("Decisão indisponível");
  });
});
