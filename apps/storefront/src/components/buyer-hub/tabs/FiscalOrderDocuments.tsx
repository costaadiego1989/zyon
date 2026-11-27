"use client";
import { useEffect, useRef, useState } from "react";
import { getValidBuyer } from "@/lib/buyer-auth";
import {
  BuyerFiscalError,
  fetchBuyerFiscalNotes,
  fetchBuyerFiscalDocument,
  type BuyerFiscalNote,
} from "@/lib/services/buyer-fiscal.service";
const states: Record<string, string> = {
  awaiting_payment: "Aguardando pagamento",
  queued: "Na fila",
  processing: "Em processamento",
  reconciliation_required: "Conciliação necessária",
  action_required: "Ação necessária",
  rejected: "Rejeitada",
  authorized: "Autorizada",
  cancelled: "Cancelada",
  suppressed: "Emissão suprimida",
  not_eligible_before_activation: "Venda anterior à ativação",
};
export function FiscalOrderDocuments({
  merchantId,
  orderId,
  buyerToken,
  initialEnvironment = "production",
  intentId,
  requestedDocument,
}: {
  merchantId: string;
  orderId: string;
  buyerToken: string;
  initialEnvironment?: "production" | "homologation";
  intentId?: string;
  requestedDocument?: "xml" | "danfe";
}) {
  const [environment, setEnvironment] = useState(initialEnvironment),
    [notes, setNotes] = useState<BuyerFiscalNote[] | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    urls = useRef(new Set<string>()),
    controller = useRef<AbortController>();
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    const current = ++generation.current;
    setNotes(null);
    setError("");
    if (getValidBuyer()?.token !== buyerToken) {
      setError(new BuyerFiscalError(401).message);
      return;
    }
    void fetchBuyerFiscalNotes(merchantId, orderId, environment, c.signal)
      .then((value) => {
        if (
          current === generation.current &&
          getValidBuyer()?.token === buyerToken
        )
          setNotes(value);
      })
      .catch((e) => {
        if (current === generation.current && !c.signal.aborted)
          setError(
            e instanceof BuyerFiscalError
              ? e.message
              : new BuyerFiscalError(503).message
          );
      });
    return () => {
      generation.current++;
      c.abort();
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, [merchantId, orderId, buyerToken, environment, revision]);
  async function download(note: BuyerFiscalNote, kind: "xml" | "danfe") {
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      const file = await fetchBuyerFiscalDocument(
        merchantId,
        orderId,
        note.intentId,
        environment,
        kind,
        controller.current?.signal
      );
      if (
        current !== generation.current ||
        getValidBuyer()?.token !== buyerToken
      )
        return;
      const url = URL.createObjectURL(file.blob);
      urls.current.add(url);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }, 0);
    } catch (e) {
      if (current === generation.current && !controller.current?.signal.aborted)
        setError(
          e instanceof BuyerFiscalError
            ? e.message
            : new BuyerFiscalError(503).message
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label={`Notas fiscais do pedido ${orderId}`}
      style={{
        display: "grid",
        gap: 12,
        borderTop: "1px solid var(--aacp-line)",
        paddingTop: 16,
        fontSize: 13,
        overflowWrap: "anywhere",
      }}
    >
      <h3 style={{ margin: 0, fontSize: 15 }}>Nota fiscal</h3>
      <label>
        Ambiente fiscal
        <select
          aria-label="Ambiente da nota fiscal"
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as typeof environment)}
          style={{
            display: "block",
            width: "100%",
            minHeight: 40,
            background: "var(--aacp-surface-2)",
            color: "var(--aacp-fg)",
            border: "1px solid var(--aacp-line)",
            borderRadius: 8,
            padding: 8,
          }}
        >
          <option value="production">Produção</option>
          <option value="homologation">
            Homologação · sem validade fiscal
          </option>
        </select>
      </label>
      {error ? (
        <p role="alert">{error}</p>
      ) : notes === null ? (
        <p role="status">Carregando nota fiscal…</p>
      ) : notes.length === 0 ? (
        <p>Nenhuma nota fiscal disponível para este pedido.</p>
      ) : (
        notes.map((note) => (
          <article
            key={note.intentId}
            aria-label={
              intentId === note.intentId
                ? "Nota fiscal selecionada"
                : "Nota fiscal do vendedor"
            }
            style={{ display: "grid", gap: 8 }}
          >
            <strong>
              Estado fiscal: {states[note.state] ?? "Aguardando atualização"}
            </strong>
            {note.number && (
              <span>
                NF-e {note.number} · Série {note.series}
              </span>
            )}
            {note.authorizationProtocol && (
              <span>
                Protocolo de autorização: {note.authorizationProtocol}
              </span>
            )}
            {note.accessKey && <span>Chave de acesso: {note.accessKey}</span>}
            {note.cancellationProtocol && (
              <span>
                Protocolo de cancelamento: {note.cancellationProtocol}
              </span>
            )}
            {note.documentState === "document_pending" && (
              <p>
                {note.authorizationProtocol
                  ? "Arquivos em recuperação. A autorização confirmada permanece preservada."
                  : "A nota ainda não foi autorizada. Os arquivos estarão disponíveis após a autorização."}
              </p>
            )}
            {intentId === note.intentId && requestedDocument && (
              <p>
                {requestedDocument === "xml" ? "XML" : "DANFE"} selecionado. Use
                o botão para baixar o arquivo privado.
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {note.documents.map((file) => (
                <button
                  key={file.kind}
                  type="button"
                  data-neu="control"
                  disabled={busy || !file.available}
                  onClick={() => download(note, file.kind)}
                  style={{
                    minHeight: 44,
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--aacp-line)",
                    background: "var(--aacp-surface-2)",
                    color: "var(--aacp-fg)",
                    cursor: file.available ? "pointer" : "default",
                  }}
                >
                  Baixar {file.kind === "xml" ? "XML" : "DANFE"}
                  {file.available ? "" : " · pendente"}
                </button>
              ))}
            </div>
          </article>
        ))
      )}
      <button
        type="button"
        data-neu="control"
        onClick={() => setRevision((v) => v + 1)}
        disabled={busy}
        style={{
          minHeight: 40,
          padding: 8,
          borderRadius: 8,
          border: "1px solid var(--aacp-line)",
          background: "var(--aacp-surface-2)",
          color: "var(--aacp-fg)",
        }}
      >
        Atualizar nota fiscal
      </button>
    </section>
  );
}
