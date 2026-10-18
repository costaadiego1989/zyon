import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { type createDashboardApi, type MerchantAiUsage } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { showToast } from "../../components/Toast.js";

type Props = {
  api: ReturnType<typeof createDashboardApi>;
  period: { from: string; to: string };
  reload: number;
};
const integer = (value: string) => new Intl.NumberFormat("pt-BR").format(BigInt(value));
const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value));

export function AiUsageReport({ api, period, reload }: Props) {
  const [data, setData] = useState<MerchantAiUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false); setExportError(false);
    api.getAiUsage({ from: period.from, to: period.to })
      .then(result => { if (active) setData(result); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, period.from, period.to, reload, retry]);

  async function download() {
    if (exporting || loading || error) return;
    setExporting(true); setExportError(false);
    try {
      const response = await api.getAiUsageCsv(period);
      if (!response.ok) throw Error("export_failed");
      const href = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = href; link.download = `consumo-ia-${period.from}-${period.to}.csv`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(href);
      showToast("success", "Relatório de consumo baixado.");
    } catch { setExportError(true); }
    finally { setExporting(false); }
  }

  const summary = data?.summary;
  const noMeasurement = summary?.measured_requests === "0" && summary.pending_requests !== "0";
  return <section className="panel ai-usage" aria-labelledby="ai-usage-title" aria-busy={loading}>
    <header className="ai-usage__header">
      <div><h2 id="ai-usage-title">Consumo de IA</h2><p>Voz e tokens utilizados pela sua loja no período selecionado.</p></div>
      <Button variant="outline" size="sm" onClick={() => void download()} disabled={loading || error || exporting || !data}><Download size={14} />{exporting ? "Gerando..." : "Baixar consumo"}</Button>
    </header>
    {loading ? <div className="ai-usage__loading" role="status">Carregando consumo de IA...</div> : error ? <div className="ai-usage__error" role="alert">Não foi possível carregar o consumo.<Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>Tentar novamente</Button></div> : data && summary ? <>
      <dl className="ai-usage__metrics">
        <div><dt>Sessões de voz</dt><dd>{integer(summary.voice_sessions)}</dd><p>Com atividade registrada</p></div>
        <div><dt>Tokens de entrada</dt><dd>{noMeasurement ? "—" : integer(summary.input_tokens)}</dd><p>Conteúdo enviado à IA</p></div>
        <div><dt>Tokens de saída</dt><dd>{noMeasurement ? "—" : integer(summary.output_tokens)}</dd><p>Conteúdo gerado pela IA</p></div>
      </dl>
      {summary.requests === "0" && summary.voice_sessions === "0" ? <p className="ai-usage__note">Nenhum consumo registrado neste período. Os dados aparecem após o uso de IA na loja.</p> : null}
      {summary.pending_requests !== "0" || data.coverage.incomplete_voice_sessions !== "0" ? <p className="ai-usage__note" role="status">Medição parcial: {integer(summary.pending_requests)} requisições sem tokens informados e {integer(data.coverage.incomplete_voice_sessions)} sessões de voz com medição incompleta. Os totais incluem apenas os tokens recebidos.</p> : null}
      <details className="ai-usage__details">
        <summary>Detalhes do consumo e da medição</summary>
        <div className="ai-usage__detail-content">
          <p>Tokens são unidades de conteúdo processado pela IA. Entrada e saída incluem texto e áudio; os detalhes abaixo já fazem parte dos totais.</p>
          <div className="ai-usage__table-wrap"><table><caption className="sr-only">Tokens por tipo de conteúdo</caption><thead><tr><th>Conteúdo</th><th>Entrada</th><th>Saída</th></tr></thead><tbody>
            <tr><th scope="row">Texto</th><td>{noMeasurement ? "—" : integer(summary.text_input_tokens)}</td><td>{noMeasurement ? "—" : integer(summary.text_output_tokens)}</td></tr>
            <tr><th scope="row">Áudio</th><td>{noMeasurement ? "—" : integer(summary.audio_input_tokens)}</td><td>{noMeasurement ? "—" : integer(summary.audio_output_tokens)}</td></tr>
            {(BigInt(summary.input_tokens) > BigInt(summary.text_input_tokens) + BigInt(summary.audio_input_tokens) || BigInt(summary.output_tokens) > BigInt(summary.text_output_tokens) + BigInt(summary.audio_output_tokens)) ? <tr><th scope="row">Outros / sem classificação</th><td>{integer(String(BigInt(summary.input_tokens) - BigInt(summary.text_input_tokens) - BigInt(summary.audio_input_tokens)))}</td><td>{integer(String(BigInt(summary.output_tokens) - BigInt(summary.text_output_tokens) - BigInt(summary.audio_output_tokens)))}</td></tr> : null}
          </tbody></table></div>
          <p>{integer(summary.requests)} requisições registradas · {integer(summary.measured_requests)} com tokens informados · {integer(summary.rejected_requests)} recusadas pelo provedor.</p>
          {data.daily.length ? <div className="ai-usage__table-wrap ai-usage__daily"><table><caption>Consumo por dia · horário de Brasília</caption><thead><tr><th>Dia</th><th>Entrada</th><th>Saída</th><th>Sem medição</th></tr></thead><tbody>{data.daily.map(day => <tr key={day.date}><th scope="row">{date(day.date + "T12:00:00-03:00")}</th><td>{day.measured_requests === "0" && day.pending_requests !== "0" ? "—" : integer(day.input_tokens)}</td><td>{day.measured_requests === "0" && day.pending_requests !== "0" ? "—" : integer(day.output_tokens)}</td><td>{integer(day.pending_requests)}</td></tr>)}</tbody></table></div> : null}
          <p>Uso informado pelos provedores e registrado no servidor. {data.coverage.first_recorded_at ? `Primeiro registro da loja em ${date(data.coverage.first_recorded_at)}. ` : ""}Dados anteriores ao início da coleta não são retroativos.</p>
          <p>As sessões de voz mostram atividade observada, sem estimativa de minutos. Esse total ainda não corresponde ao contador de franquia do plano.</p>
          <p>Este relatório informa consumo e não altera a cobrança do seu plano.</p>
        </div>
      </details>
      <footer className="ai-usage__footer">Atualizado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(data.generated_at))} · horário de Brasília</footer>
    </> : null}
    {exportError ? <p className="ai-usage__error" role="alert">Não foi possível baixar o consumo. Tente novamente.</p> : null}
  </section>;
}
