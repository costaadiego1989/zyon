import React, { useId } from "react";
import { Package, CheckCircle, AlertCircle, ExternalLink } from "lucide-react";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { Button } from "../../../components/Button.js";
import type { DeliveryConfig } from "../../../api/endpoints/delivery.js";
interface MelhorEnvioCardProps {
  config: DeliveryConfig;
  saving: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onConnect: () => void;
}
export function MelhorEnvioCard({ config, saving, onToggle, onConnect }: MelhorEnvioCardProps) {
  const switchId = useId();
  const isConnected = config.melhorEnvioConnected;
  const isExpired = !!(isConnected && config.melhorEnvioExpiresAt && new Date(config.melhorEnvioExpiresAt) < new Date());
  const ready = isConnected && !isExpired;
  return <div className="delivery-provider">
    <div className="delivery-provider__heading"><Package size={20} aria-hidden="true" /><div><h2>Melhor Envio</h2><p>Envie pedidos pelos Correios e outras transportadoras.</p></div></div>
    <div className="delivery-provider__activation"><label htmlFor={switchId}>{config.melhorEnvioEnabled ? "Melhor Envio ativado" : "Ativar Melhor Envio"}</label><ToggleSwitch id={switchId} checked={config.melhorEnvioEnabled} onChange={onToggle} disabled={saving} /></div>
    {config.melhorEnvioEnabled ? <div className="delivery-provider__summary">
      <div><strong style={{ display: "flex", alignItems: "center", gap: 8 }}>{ready ? <CheckCircle size={16} color="var(--good)" /> : <AlertCircle size={16} />}{ready ? "Conta conectada" : isExpired ? "Conexão expirada" : "Conexão pendente"}</strong>
        <p>{ready && config.melhorEnvioExpiresAt ? `Conexão válida até ${new Date(config.melhorEnvioExpiresAt).toLocaleDateString("pt-BR")}.` : ready ? "A conta está conectada para consultar fretes e gerar etiquetas." : "Conecte sua conta para disponibilizar esta modalidade."}</p></div>
      {!ready && <Button variant="outline" onClick={onConnect} disabled={saving}><ExternalLink size={14} />{isExpired ? "Reconectar conta" : "Conectar conta"}</Button>}
    </div> : <p>Ative e conecte sua conta para oferecer os serviços disponíveis para a loja.</p>}
  </div>;
}
