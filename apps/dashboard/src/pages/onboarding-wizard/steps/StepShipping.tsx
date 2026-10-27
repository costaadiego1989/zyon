import React from "react";
import { Truck, CheckCircle2 } from "lucide-react";
import { Button } from "../../../components/Button.js";
import type { useStepShipping } from "../hooks/useStepShipping.js";

export function StepShipping({ shipping }: { shipping: ReturnType<typeof useStepShipping> }) {
  const ownDelivery = shipping.config?.ownDelivery.enabled;
  const carrierReady = shipping.config?.melhorEnvioEnabled && shipping.config.melhorEnvioConnected &&
    (!shipping.config.melhorEnvioExpiresAt || Date.parse(shipping.config.melhorEnvioExpiresAt) > Date.now());
  return <div className="onb-fields">
    <p className="onb-help">Configure o frete para entregar seus pedidos. Você pode usar o Melhor Envio, a entrega própria ou os dois juntos em Frete e entregas.</p>
    <ol className="onb-review-list">
      <li>Escolha como a loja vai entregar os pedidos.</li>
      <li>Configure a modalidade e confira o endereço de origem, as tarifas e os prazos.</li>
      <li>Com a modalidade ativa, continue para os pagamentos.</li>
    </ol>
    <div className="onb-shipping-provider">
      <Truck size={22} aria-hidden="true" />
      <div><h3>{ownDelivery && carrierReady ? "Melhor Envio e entrega própria ativos" : shipping.ready && ownDelivery ? "Entrega própria ativa" : "Melhor Envio"}</h3><p>{ownDelivery ? "Revise valores, prazos e regiões atendidas em Frete e entregas." : "Cotação, etiquetas e rastreio com as transportadoras disponíveis na sua conta."}</p></div>
      {shipping.ready ? <span className="onb-shipping-status" role="status"><CheckCircle2 size={16} aria-hidden="true" /> Modalidade ativa</span> : <Button variant="outline" size="sm" disabled={shipping.loading || shipping.connecting} onClick={() => void shipping.connect()}>{shipping.connecting ? "Conectando…" : "Conectar Melhor Envio"}</Button>}
    </div>
    <div className="onb-shipping-actions"><a href="#delivery" className="btn btn-outline">Configurar frete e entregas</a><Button variant="ghost" disabled={shipping.loading || shipping.connecting} onClick={shipping.refresh}>{shipping.loading ? "Consultando…" : "Atualizar configuração"}</Button></div>
    {shipping.error && <p className="onb-message" role="alert">{shipping.error}</p>}
    {!shipping.loading && !shipping.ready && !shipping.error && <p className="onb-help" role="status">Ative uma modalidade de entrega para liberar a próxima etapa. Uma conexão expirada precisa ser renovada.</p>}
    <p className="onb-help">As etiquetas do Melhor Envio são cobradas na sua carteira do provedor. Na entrega própria, a loja define os valores e realiza os envios.</p>
  </div>;
}
