import type { MetaAdsDailyReport } from '@zyon/shared-types';
import { executionStates, money, priorities } from './presentation.js';

const analysis={pending:'Análise pendente',completed:'Análise concluída',awaiting_data:'Dados insuficientes para avaliar desempenho',unknown:'Análise com resultado desconhecido. O consumo não será repetido automaticamente.',unavailable:'Análise indisponível'};
const outcome:Record<string,string>={...executionStates,pending_review:'Aguardando aprovação',approved:'Aprovada, aguardando execução',executed:'Execução registrada',rejected:'Proposta rejeitada',stale:'Proposta desatualizada',blocked:'Ação bloqueada',generation_pending:'Aguardando novos criativos',creative_review_required:'Revise os novos criativos antes de alterar a campanha',awaiting_data:'Dados insuficientes',manual:'Aprovação manual necessária'};
const errors:Record<string,string>={authorization_limit_exceeded:'O teto autorizado não permite esta ação.',automatic_budget_control_unavailable:'Não foi possível comprovar o controle financeiro necessário.',automatic_authority_unavailable:'A política automática não está válida para esta ação.',meta_execution_unknown:'A Meta não confirmou o resultado. Consulte o histórico antes de agir novamente.'};
const note=(value:string)=>value==='observed_attribution_not_causal_uplift'?'A receita atribuída é uma observação da Meta; não comprova aumento causal das vendas.':value;
function instant(value:string,zone:string){try{if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value.split('-').reverse().join('/');return new Date(value).toLocaleString('pt-BR',{timeZone:zone,timeZoneName:'short'});}catch{return 'Horário indisponível';}}
export function DailyReportArtifact({report,campaignNames={},onReview}:{report:MetaAdsDailyReport;campaignNames?:Record<string,string>;onReview?:(proposalId:string)=>void}) {
  return <article className="mga-daily-report" aria-label={`Relatório diário ${report.localDay}`}>
    <h3>Relatório de {report.localDay.split('-').reverse().join('/')}</h3><p>Conta {report.accountId} · {report.timezone}</p>
    <p>Dia encerrado: <time dateTime={report.since}>{instant(report.since,report.timezone)}</time> até <time dateTime={report.until}>{instant(report.until,report.timezone)}</time>. A janela de avaliação do desempenho pode abranger mais dias.</p>
    <p>{report.status==='partial'?'Coleta parcial':report.status==='collecting'?'Coleta em andamento':'Coleta concluída'} · {analysis[report.analysisStatus]}</p>
    <p>Coleta: {report.collectedAt?<time dateTime={report.collectedAt}>{instant(report.collectedAt,report.timezone)}</time>:'Ainda não concluída'} · Atualização: <time dateTime={report.updatedAt}>{instant(report.updatedAt,report.timezone)}</time></p>
    {!!report.notes.length&&<ul>{report.notes.map(value=><li key={value}>{note(value)}</li>)}</ul>}
    {!report.campaigns.length&&<p>Nenhuma campanha disponível para este dia. Isso não confirma gasto zero.</p>}
    {report.campaigns.map(row=><section key={row.campaignId} className="mga-daily-campaign"><h4>{campaignNames[row.campaignId]??'Campanha da loja'}</h4>
      {row.status!=='available'&&<p>{row.status==='awaiting_data'?'Dados insuficientes':'Métricas indisponíveis'}. A avaliação aguarda cobertura e maturação suficientes.</p>}
      {!!row.missing.length&&<ul>{row.missing.map(value=><li key={value}>{value}</li>)}</ul>}
      {row.metrics?<><dl className="mga-ledger mga-results">
        <div><dt>Gasto de mídia</dt><dd>{money(row.metrics.spendCents,row.metrics.currency)}</dd></div>
        <div><dt>Receita atribuída pela Meta</dt><dd>{money(row.metrics.attributedRevenueCents,row.metrics.currency)}</dd></div>
        <div><dt>Vendas confirmadas na Zyon</dt><dd>{money(row.metrics.confirmedRevenueCents,row.metrics.currency)}</dd></div>
        <div><dt>Pedidos pagos confirmados</dt><dd>{row.metrics.paidOrders}</dd></div>
        <div><dt>Conversas</dt><dd>{row.metrics.conversations??'Indisponível'}</dd></div>
        <div><dt>Custo por compra</dt><dd>{money(row.metrics.costPerPurchaseCents,row.metrics.currency)}</dd></div>
        <div><dt>ROAS atribuído</dt><dd>{row.metrics.roas===null?'Indisponível':`${row.metrics.roas.toLocaleString('pt-BR')}×`}</dd></div>
        <div><dt>Contribuição após mídia</dt><dd>{money(row.metrics.contributionCents,row.metrics.currency)}</dd></div>
      </dl><small>Fonte: {row.metrics.source} · Atribuição: {row.metrics.attributionWindow} · Cobertura de custos: {row.metrics.costCoverage==='complete'?'completa':row.metrics.costCoverage==='partial'?'parcial':'indisponível'}</small>
        {row.metrics.stale&&<p>Dados anteriores, ainda sem atualização confirmada para esta coleta.</p>}
        {!!row.metrics.notes.length&&<ul>{row.metrics.notes.map(value=><li key={value}>{note(value)}</li>)}</ul>}
      </>:<p>Valores indisponíveis. Ausência de dados não significa ausência de gasto ou vendas.</p>}
      {row.recommendations.map(recommendation=><div className="mga-daily-recommendation" key={recommendation.id}><strong>{recommendation.status==='awaiting_data'?'Aguardando dados':'Recomendação'} · {priorities[recommendation.priority]}</strong><p>{recommendation.hypothesis}</p>
        <dl className="mga-ledger">{Object.entries(recommendation.evidence).map(([key,value])=><div key={key}><dt>{({spendCents:'Gasto observado',roas:'ROAS observado',confirmedRevenueCents:'Receita confirmada',paidOrders:'Pedidos pagos',conversations:'Conversas'} as Record<string,string>)[key]??key.replaceAll('_',' ')}</dt><dd>{value===null?'Indisponível':key.endsWith('Cents')&&typeof value==='number'?money(value):String(value)}</dd></div>)}</dl>
      </div>)}
      {row.actions.map((action,index)=><div className="mga-daily-action" key={action.proposalId||`${row.campaignId}-${index}`}><p><strong>{outcome[action.status]??'Resultado requer revisão'}</strong></p><p>{action.reason}</p>{action.error&&<p role="status">{errors[action.error]??'Não foi possível confirmar esta ação. Consulte a proposta e o histórico.'}</p>}
        {onReview&&action.proposalId&&action.status==='pending_review'&&<button type="button" className="mga-secondary" onClick={()=>onReview(action.proposalId)}>Revisar proposta</button>}
      </div>)}
    </section>)}
  </article>;
}
