import React, { useEffect, useMemo, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { marketingApi } from "../../api/marketing.js";
import { Button } from "../../components/Button.js";
import { PageLoader } from "../../components/PageLoader.js";
import { EmptyState } from "../../components/EmptyState.js";
import "./marketing.css";

/** Staff can inspect this feature entitlement without access to the owner's billing details. */
export function MarketingAccessGate({
  apiBaseUrl,
  children,
  canUpgrade = false,
}: {
  apiBaseUrl: string;
  children: React.ReactNode;
  canUpgrade?: boolean;
}) {
  const api = useMemo(() => marketingApi(apiBaseUrl), [apiBaseUrl]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true,
      pending = false;
    setLoading(true);
    const read = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api.access();
        if (active) {
          setEnabled(result.enabled);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };
    void read();
    const refresh = () => void read();
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [api, revision]);
  if (loading) return <PageLoader variant="section" />;
  if (error)
    return (
      <div role="alert" className="marketing-notice">
        Não foi possível verificar o acesso da loja.
        <Button
          variant="outline"
          onClick={() => setRevision((value) => value + 1)}
        >
          Tentar novamente
        </Button>
      </div>
    );
  if (!enabled)
    return (
      <EmptyState
        icon={LockKeyhole}
        title="Disponível a partir do plano Growth"
        description="Conversas, contatos e campanhas estão incluídos nos planos Growth e Escala."
        action={
          canUpgrade ? (
            <a className="zyn-btn zyn-btn--primary" href="#billing-plans">
              Ver planos
            </a>
          ) : (
            <p>Peça ao responsável pela loja para consultar o plano.</p>
          )
        }
      />
    );
  return <>{children}</>;
}
