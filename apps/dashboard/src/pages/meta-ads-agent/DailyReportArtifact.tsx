import type { MetaAdsDailyReport } from '@zyon/shared-types';
import { adReason, executionStates, money, priorities, attributionWindowLabel } from './presentation.js';

const analysis={pending:'Análise pendente',completed:'Análise concluída',awaiting_data:'Dados insuficientes para avaliar desempenho',unknown:'Análise com resultado desconhecido. O consumo não será repetido automaticamente.',unavailable:'Análise indisponível'};
const outcome:Record<string,string>={...executionStates,pending_review:'Aguardando aprovação',approved:'Aprovada, aguardando execução',executed:'Execução registrada',rejected:'Proposta rejeitada',stale:'Proposta desatualizada',blocked:'Ação bloqueada',generation_pending:'Aguardando novos criativos',creative_review_required:'Revise os novos criativos antes de alterar a campanha',awaiting_data:'Dados insuficientes',manual:'Aprovação manual necessária'};
const errors:Record<string,string>={authorization_limit_exceeded:'O teto autorizado não permite esta ação.',automatic_budget_control_unavailable:'Não foi possível comprovar o controle financeiro necessário.',automatic_authority_unavailable:'A política automática não está válida para esta ação.',meta_execution_unknown:'A Meta não confirmou o resultado. Consulte o histórico antes de agir novamente.'};
const labels:Record<string,string>={since:'Início da análise',until:'Fim da análise',currency:'Moeda',attributionWindow:'Prazo considerado pela Meta',updatedAt:'Atualização dos dados',spendCents:'Gasto observado',confirmedRevenueCents:'Receita confirmada',attributedRevenueCents:'Vendas informadas pela Meta',paidOrders:'Pedidos pagos',conversations:'Conversas',costPerPurchaseCents:'Custo por compra',roas:'Retorno dos anúncios',contributionCents:'Resultado com custos informados',costCoverage:'Cobertura de custos'};
const coverage:Record<string,string>={complete:'completa',partial:'parcial',unavailable:'indisponível'};
function instant(value:string,zone:string){try{if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value.split('-').reverse().join('/');return new Date(value).toLocaleString('pt-BR',{timeZone:zone,timeZoneName:'short'});}catch{return 'Horário indisponível';}}
function evidenceValue(key:string,value:string|number|boolean|null,zone:string,currency:string) {
  if(value===null)return 'Indisponível';
  if(key.endsWith('Cents')&&typeof value==='number')return money(value,currency);
  if(['since','until','updatedAt'].includes(key)&&typeof value==='string')return instant(value,zone);
  if(key==='costCoverage')return coverage[String(value)]??'indisponível';
  if(key==='attributionWindow')return attributionWindowLabel(String(value));
  return String(value);
}
export function DailyReportArtifact({report,campaignNames={},onReview}:{report:MetaAdsDailyReport;campaignNames?:Record<string,string>;onReview?:(proposalId:string)=>void}) {
  return <article className="mga-daily-report" aria-label={`Relatório diário ${report.localDay}`}>
    <header className="mga-report-heading"><div><h3>Relatório de {report.localDay.split('-').reverse().join('/')}</h3><small>Conta {report.accountId} · {report.timezone}</small></div><span className="mga-report-state" data-state={report.status}>{report.status==='partial'?'Coleta parcial':report.status==='collecting'?'Coleta em andamento':'Coleta concluída'}</span></header>
    <p className="mga-report-period">Dia encerrado: <time dateTime={report.since}>{instant(report.since,report.timezone)}</time> até <time dateTime={report.until}>{instant(report.until,report.timezone)}</time>. A janela de avaliação do desempenho pode abranger mais dias.</p>
    <p className="mga-report-assessment">{analysis[report.analysisStatus]}</p>
    {!report.campaigns.length&&<p>Nenhuma campanha disponível para este dia. Isso não confirma gasto zero.</p>}
    {report.campaigns.map(row=><section key={row.campaignId} className="mga-daily-campaign"><h4>{campaignNames[row.campaignId]??'Campanha da loja'}</h4>
      {row.status!=='available'&&<p>{row.status==='awaiting_data'?'Dados insuficientes':'Métricas indisponíveis'}. A avaliação aguarda cobertura e maturação suficientes.</p>}
      {!!row.missing.length&&<p className="mga-report-missing">Para avaliar, precisamos de {row.missing.map(adReason).join(', ')}.</p>}
      {row.metrics?<><dl className="mga-report-metrics">
        <div><dt>Investimento nos anúncios</dt><dd>{money(row.metrics.spendCents,row.metrics.currency)}</dd></div>
        <div><dt>Vendas informadas pela Meta</dt><dd>{money(row.metrics.attributedRevenueCents,row.metrics.currency)}</dd></div>
        <div><dt>Vendas confirmadas na Zyon</dt><dd>{money(row.metrics.confirmedRevenueCents,row.metrics.currency)}</dd></div>
        <div><dt>Conversas</dt><dd>{row.metrics.conversations??'Indisponível'}</dd></div>
      </dl><details className="mga-report-details"><summary>Mais métricas e origem</summary><dl className="mga-ledger">
        <div><dt>Pedidos pagos confirmados</dt><dd>{row.metrics.paidOrders}</dd></div>
        <div><dt>Custo por compra</dt><dd>{money(row.metrics.costPerPurchaseCents,row.metrics.currency)}</dd></div>
        <div><dt>Retorno dos anúncios</dt><dd>{row.metrics.roas===null?'Indisponível':`${row.metrics.roas.toLocaleString('pt-BR')}×`}</dd></div>
        <div><dt>Resultado com custos informados</dt><dd>{money(row.metrics.contributionCents,row.metrics.currency)}</dd></div>
      </dl><small>Fonte: {row.metrics.source} · Atribuição: {row.metrics.attributionWindow} · Cobertura de custos: {coverage[row.metrics.costCoverage]}</small>
        {row.metrics.stale&&<p>Dados anteriores, ainda sem atualização confirmada para esta coleta.</p>}
        {!!row.metrics.notes.length&&<ul>{row.metrics.notes.map(value=><li key={value}>{adReason(value)}</li>)}</ul>}
      </details></>:<p>Valores indisponíveis. Ausência de dados não significa ausência de gasto ou vendas.</p>}
      {row.recommendations.map(recommendation=><div className="mga-daily-recommendation" key={recommendation.id}><strong>{recommendation.status==='awaiting_data'?'Aguardando dados':'Recomendação'} · {priorities[recommendation.priority]}</strong><p>{adReason(recommendation.hypothesis)}</p>
        <details className="mga-recommendation-evidence mga-report-details"><summary>Ver dados da recomendação</summary><dl className="mga-ledger">{Object.entries(recommendation.evidence).map(([key,value])=><div key={key}><dt>{labels[key]??'Dado complementar'}</dt><dd>{labels[key]?evidenceValue(key,value,report.timezone,row.metrics?.currency??'BRL'):'Indisponível'}</dd></div>)}</dl></details>
      </div>)}
      {row.actions.map((action,index)=><div className="mga-daily-action" key={action.proposalId||`${row.campaignId}-${index}`}><p><strong>{outcome[action.status]??'Resultado requer revisão'}</strong></p><p>{adReason(action.reason)}</p>{action.error&&<p role="status">{errors[action.error]??'Não foi possível confirmar esta ação. Consulte a proposta e o histórico.'}</p>}
        {onReview&&action.proposalId&&action.status==='pending_review'&&<button type="button" className="mga-secondary" onClick={()=>onReview(action.proposalId)}>Revisar proposta</button>}
      </div>)}
    </section>)}
    <details className="mga-report-details mga-report-method"><summary>Período e atualização da coleta</summary><p>Coleta: {report.collectedAt?<time dateTime={report.collectedAt}>{instant(report.collectedAt,report.timezone)}</time>:'Ainda não concluída'} · Atualização: <time dateTime={report.updatedAt}>{instant(report.updatedAt,report.timezone)}</time></p></details>
    {!!report.notes.length&&<ul className="mga-report-notes">{report.notes.map(value=><li key={value}>{adReason(value)}</li>)}</ul>}
  </article>;
}
