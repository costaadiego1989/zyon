import React, { useCallback, useEffect, useMemo, useState } from "react";
import { marketingApi, type MarketingHistoryJob } from "../../api/marketing.js";
import { Button } from "../../components/Button.js";
import { marketingError } from "./marketing-format.js";

const labels = {
  queued: "Na fila",
  running: "Importando",
  completed: "Concluída",
  failed: "Falha na importação",
};
export function MarketingHistoryPanel({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => marketingApi(apiBaseUrl), [apiBaseUrl]);
  const [job, setJob] = useState<MarketingHistoryJob | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setJob(await api.history());
  }, [api]);
  useEffect(() => {
    let active = true;
    void api
      .history()
      .then((value) => {
        if (active) setJob(value);
      })
      .catch((error) => {
        if (active) setError(marketingError(error));
      });
    return () => {
      active = false;
    };
  }, [api]);
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    const timer = setInterval(() => {
      void load().catch((error) => setError(marketingError(error)));
    }, 3000);
    return () => clearInterval(timer);
  }, [job?.status, load]);
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      setJob(await api.importHistory());
    } catch (error) {
      setError(marketingError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="marketing-section">
      <h2>Histórico da loja</h2>
      <p>
        Traga contatos, conversas e compras já registrados nesta loja. A
        importação não envia mensagens. Origem e autorização só serão
        aproveitadas quando houver evidência.
      </p>
      {error && <p role="alert">{error}</p>}
      {job && (
        <p role="status">
          {labels[job.status]} · {job.records} registros analisados ·{" "}
          {job.messages} mensagens adicionadas.
          {job.status === "failed"
            ? " Tente novamente; os registros já importados serão preservados sem duplicação."
            : ""}
        </p>
      )}
      <Button
        loading={busy}
        disabled={job?.status === "queued" || job?.status === "running"}
        onClick={() => void start()}
      >
        {job?.status === "completed"
          ? "Importar histórico novamente"
          : "Importar histórico disponível"}
      </Button>
    </section>
  );
}
