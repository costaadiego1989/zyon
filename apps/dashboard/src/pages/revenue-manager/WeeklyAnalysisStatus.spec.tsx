import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AnalysisStatus } from "../../api/endpoints/revenue-manager.js";
import { WeeklyAnalysisStatus } from "./WeeklyAnalysisStatus.js";

const status: AnalysisStatus = {
  mode: "weekly", enabled: true, generation_enabled: false, queue_available: true,
  next_eligible_at: "2026-10-03T06:00:00Z", last_successful_at: null, overdue: true,
  run: { id: "run-1", status: "deferred_budget", result: null, reason: "generation_disabled",
    createdAt: "2026-10-03T06:00:00Z", startedAt: "2026-10-03T06:00:00Z", completedAt: null, hypothesisId: null },
};
const render = (value: AnalysisStatus) => renderToStaticMarkup(<WeeklyAnalysisStatus status={value} error={false} />);

describe("weekly analysis availability", () => {
  it("shows the platform pause prominently without promising a queued proposal", () => {
    const html = render(status);
    expect(html).toContain("<strong>Geração de sugestões pausada</strong>");
    expect(html).toContain("pausada pela Zyon");
    expect(html).toContain("ainda não tem uma nova proposta para aprovar");
    expect(html).not.toContain("Sua análise está na fila");
    expect(html).not.toContain("Prevista desde");
    expect(html).not.toContain("<button");
  });
  it("recognizes a paused run from the API before the new field is deployed", () => {
    expect(render({ ...status, generation_enabled: undefined })).toContain("<strong>Geração de sugestões pausada</strong>");
  });
  it("shows the pause even before a run is created", () => {
    expect(render({ ...status, run: null })).toContain("<strong>Geração de sugestões pausada</strong>");
  });
  it("uses current availability when generation resumes instead of a historical pause", () => {
    const html = render({ ...status, generation_enabled: true });
    expect(html).toContain("Sua análise está na fila");
    expect(html).toContain("A geração foi retomada");
    expect(html).not.toContain("pausada pela Zyon");
  });
  it("keeps completed recommendations reviewable when new generation is paused", () => {
    const html = render({ ...status, run: { ...status.run!, status: "completed", result: "recommendations", hypothesisId: "proposal-1", reason: null } });
    expect(html).toContain("Sua análise semanal foi concluída");
    expect(html).toContain("Revisar estratégia");
    expect(html).not.toContain("ainda não tem uma nova proposta");
  });
  it("does not render a review action for an unfinished run", () => {
    expect(render({ ...status, run: { ...status.run!, hypothesisId: "partial-proposal" } })).not.toContain("<button");
  });
});
