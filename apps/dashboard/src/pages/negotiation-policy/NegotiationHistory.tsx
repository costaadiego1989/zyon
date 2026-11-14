import React, { useCallback, useEffect, useRef, useState } from "react";
import { Handshake } from "lucide-react";
import { useApi } from "../../hooks/useApi.js";
import type { NegotiationSession } from "../../api/types.js";
import { Button } from "../../components/Button.js";
import { DataPanel } from "../../components/DataPanel.js";
import { EmptyState } from "../../components/EmptyState.js";
import { PageLoader } from "../../components/PageLoader.js";
export function NegotiationHistory({ merchantId }: { merchantId: string }) {
  const api = useApi();
  const [items, setItems] = useState<NegotiationSession[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0),
    busy = useRef(false);
  const load = useCallback(
    async (nextCursor?: string) => {
      if (busy.current) return;
      busy.current = true;
      const request = generation.current;
      setLoading(true);
      setError("");
      try {
        const result = await api.getNegotiationSessions({
          limit: 20,
          cursor: nextCursor,
        });
        if (request !== generation.current) return;
        setItems((previous) =>
          nextCursor
            ? [
                ...new Map(
                  [...previous, ...result.data].map((item) => [item.id, item])
                ).values(),
              ]
            : result.data
        );
        setCursor(result.next_cursor ?? undefined);
        setHasMore(result.has_more && !!result.next_cursor);
      } catch {
        if (request === generation.current)
          setError(
            "Não foi possível consultar as negociações. Tente novamente."
          );
      } finally {
        if (request === generation.current) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [api, merchantId]
  );
  useEffect(() => {
    generation.current++;
    busy.current = false;
    setItems([]);
    setCursor(undefined);
    setHasMore(false);
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  return (
    <DataPanel
      title="Negociações registradas"
      isEmpty={!loading && !error && !items.length}
      empty={{
        icon: Handshake,
        title: "Nenhuma negociação registrada",
        description:
          "As negociações aparecerão aqui quando houver tentativas registradas para a loja.",
      }}
    >
      {loading && !items.length ? <PageLoader /> : null}
      {!!items.length && (
        <div className="negotiation-history-table">
          <table>
            <thead>
              <tr>
                <th>Referência</th>
                <th>Desconto autorizado</th>
                <th>Resultado</th>
                <th>Registrado em</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <code title={item.id}>{item.id.slice(0, 8)}</code>
                  </td>
                  <td>
                    {item.agreement
                      ? item.selected_discount_percent.toLocaleString("pt-BR") +
                        "%"
                      : "Sem oferta autorizada"}
                  </td>
                  <td>
                    {item.applied_at
                      ? "Aplicado no checkout"
                      : item.agreement
                      ? "Acordo autorizado"
                      : "Sem acordo"}
                  </td>
                  <td>{new Date(item.created_at).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && (
        <EmptyState
          title="Histórico indisponível"
          description={error}
          action={
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void load(items.length ? cursor : undefined)}
            >
              Tentar novamente
            </Button>
          }
        />
      )}
      {hasMore && !error && (
        <div className="negotiation-history-more">
          <Button
            variant="outline"
            loading={loading}
            onClick={() => void load(cursor)}
          >
            Carregar mais negociações
          </Button>
        </div>
      )}
    </DataPanel>
  );
}
