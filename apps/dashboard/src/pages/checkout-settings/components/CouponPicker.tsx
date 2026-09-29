import React, { useEffect, useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import { Button } from "../../../components/Button.js";
import { FormSelect } from "../../../components/FormField.js";

export function CouponPicker({ value, onChange, disabled, label = "Código do cupom" }: { value: string; onChange: (code: string) => void; disabled?: boolean; label?: string }) {
  const api = useApi();
  const [codes, setCodes] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    void api.listCoupons().then(list => {
      if (!alive) return;
      setCodes([...new Set(list.flatMap(c => c.isActive && typeof c.code === "string" ? [c.code] : []))]);
      setStatus("ready");
    }).catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [api, attempt]);
  return <div className="cfg-editor-coupon">
    <FormSelect label={label} hint={status === "loading" ? "Carregando cupons…" : status === "ready" && !codes.length ? "Nenhum cupom ativo disponível. Cadastre um em Cupons para usar aqui." : "O cupom continua sujeito à validade e aos limites de uso."}
      value={value} disabled={disabled || status !== "ready"} onChange={onChange} options={[{ value: "", label: "Sem cupom" }, ...(value && !codes.includes(value) ? [{ value, label: `${value} (cupom atual)` }] : []), ...codes.map(code => ({ value: code, label: code }))]} />
    {status === "error" && <div className="cfg-editor-feedback"><p role="alert">Não foi possível consultar os cupons. Sua seleção foi mantida.</p><Button variant="outline" size="sm" disabled={disabled} onClick={() => setAttempt(a => a + 1)}>Tentar novamente</Button></div>}
  </div>;
}
