import React, { useEffect, useMemo, useState } from "react";
import { marketingApi, type MarketingSettings } from "../../api/marketing.js";
import { Button } from "../../components/Button.js";
import { PageLoader } from "../../components/PageLoader.js";
import { marketingError } from "./marketing-format.js";
import { MarketingHistoryPanel } from "./MarketingHistoryPanel.js";
const empty = {
  timezone: "",
  startHour: "",
  endHour: "",
  minIntervalHours: "",
  maxMessagesPerDay: "",
  retentionDays: "",
};
export function MarketingSettingsPanel({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => marketingApi(apiBaseUrl), [apiBaseUrl]);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void api
      .settings()
      .then((settings) => {
        if (active && settings)
          setForm({
            timezone: settings.timezone,
            startHour: String(settings.startHour),
            endHour: String(settings.endHour),
            minIntervalHours: String(settings.minIntervalHours),
            maxMessagesPerDay: String(settings.maxMessagesPerDay),
            retentionDays: String(settings.retentionDays),
          });
      })
      .catch((error) => {
        if (active) setError(marketingError(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, revision]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api.configure({
        timezone: form.timezone.trim(),
        startHour: Number(form.startHour),
        endHour: Number(form.endHour),
        minIntervalHours: Number(form.minIntervalHours),
        maxMessagesPerDay: Number(form.maxMessagesPerDay),
        retentionDays: Number(form.retentionDays),
      } satisfies Omit<MarketingSettings, "configured">);
      setSaved(true);
    } catch (error) {
      setError(marketingError(error));
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <PageLoader variant="section" />;
  return (
    <>
      <form className="marketing-form marketing-section" onSubmit={submit}>
        <h2>Controles de comunicação</h2>
        <p>
          Defina os limites da loja antes de aprovar a primeira campanha.
          Recuperação e pós-venda compartilham a frequência comercial
          configurada.
        </p>
        {error && (
          <p role="alert" className="marketing-notice">
            {error}
            <Button
              variant="outline"
              onClick={() => setRevision((value) => value + 1)}
            >
              Recarregar
            </Button>
          </p>
        )}
        {saved && <p role="status">Configurações salvas.</p>}
        <label>
          Fuso horário
          <input
            required
            maxLength={100}
            value={form.timezone}
            onChange={(event) =>
              setForm((previous) => ({
                ...previous,
                timezone: event.target.value,
              }))
            }
            placeholder="Ex.: America/Sao_Paulo"
          />
        </label>
        <div className="marketing-form-columns">
          <label>
            Hora inicial
            <input
              required
              type="number"
              min={0}
              max={23}
              step={1}
              value={form.startHour}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  startHour: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Hora final
            <input
              required
              type="number"
              min={1}
              max={24}
              step={1}
              value={form.endHour}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  endHour: event.target.value,
                }))
              }
            />
          </label>
        </div>
        <p className="marketing-help">
          Use horas de 0 a 24. O envio começa na hora inicial e termina antes da
          hora final. Você também pode configurar um período que atravesse a
          meia-noite.
        </p>
        <label>
          Intervalo mínimo entre comunicações (horas)
          <input
            required
            type="number"
            min={1}
            max={8760}
            step={1}
            value={form.minIntervalHours}
            onChange={(event) =>
              setForm((previous) => ({
                ...previous,
                minIntervalHours: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Máximo de mensagens comerciais por contato em 24 horas
          <input
            required
            type="number"
            min={1}
            max={100}
            step={1}
            value={form.maxMessagesPerDay}
            onChange={(event) =>
              setForm((previous) => ({
                ...previous,
                maxMessagesPerDay: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Retenção de leads inativos (dias)
          <input
            required
            type="number"
            min={1}
            max={3650}
            step={1}
            value={form.retentionDays}
            onChange={(event) =>
              setForm((previous) => ({
                ...previous,
                retentionDays: event.target.value,
              }))
            }
          />
        </label>
        <p className="marketing-help">
          A limpeza de leads inativos preserva compras e os registros mínimos
          necessários para respeitar pedidos de descadastro.
        </p>
        <Button type="submit" loading={busy}>
          Salvar configurações
        </Button>
      </form>
      <MarketingHistoryPanel apiBaseUrl={apiBaseUrl} />
    </>
  );
}
