import React from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "../../../components/Button.js";

type CompletedViewProps = { name: string; onFinished: () => void };
export function CompletedView({ name, onFinished }: CompletedViewProps) {
  return <section className="onb-complete">
    <div className="onb-complete-card">
      <CheckCircle2 size={40} color="var(--color-brand)" aria-hidden="true" />
      <h1 className="onb-complete-title">Configuração inicial salva, {name}.</h1>
      <p className="onb-complete-lead">Antes de divulgar a loja, confira os produtos, os meios de pagamento e as opções de entrega. Conexões em análise dependem da confirmação do provedor.</p>
      <ol className="onb-review-list"><li>Revise preços e disponibilidade em Produtos.</li><li>Confira quais meios estão ativos em Pagamentos.</li><li>Abra a loja e confira a experiência de compra.</li></ol>
      <Button variant="primary" arrow onClick={onFinished}>Ir para o painel</Button>
    </div>
  </section>;
}
