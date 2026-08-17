import React from "react";
import { Rocket } from "lucide-react";
import { Button } from "../../../components/Button.js";

type CompletedViewProps = {
  name: string;
  onFinished: () => void;
};

export function CompletedView({ name, onFinished }: CompletedViewProps) {
  return (
    <div className="onb-complete">
      <div className="onb-complete-card">
        <div className="onb-widget-orb" style={{ "--orb-c1": "#22c55e", "--orb-c2": "#22c55ecc", "--orb-c3": "#22c55e66", width: 100, height: 100 } as React.CSSProperties}>
          <div className="onb-widget-orb__halo" />
          <div className="onb-widget-orb__core" />
          <div className="onb-widget-orb__eyes" style={{ flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <span style={{ width: 10, height: 14, borderRadius: "50%", background: "#fff", boxShadow: "0 0 6px rgba(0,0,0,0.2)" }} />
              <span style={{ width: 10, height: 14, borderRadius: "50%", background: "#fff", boxShadow: "0 0 6px rgba(0,0,0,0.2)" }} />
            </div>
            <svg width="20" height="10" viewBox="0 0 20 10" fill="none" style={{ marginTop: 4 }}>
              <path d="M4 4c3 4 9 4 12 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </div>
        </div>
        <h1 className="onb-complete-title" style={{ marginTop: 24 }}>Checkout ativo, {name}!</h1>
        <p className="onb-complete-lead">
          Seu agente de vendas está pronto para converter. Compradores já podem interagir com o checkout assistido na sua loja.
        </p>
        <Button variant="primary" arrow onClick={onFinished}>
          <Rocket size={15} style={{ marginRight: 8 }} />
          Ir para o painel
        </Button>
      </div>
    </div>
  );
}
