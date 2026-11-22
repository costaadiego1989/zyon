import type {ReactNode} from 'react';
import {ArrowLeft,ArrowRight,ChevronRight,Search} from 'lucide-react';
import type {MetaAdsAudienceSummary,MetaAdsCampaignFilter,MetaAdsCampaignWorkspacePage,MetaAdsCampaignWorkspaceRow,MetaAdsWorkspaceQuery} from '@zyon/shared-types';
import {TabBar} from '../../components/TabBar.js';
import {PeriodFilter} from '../../components/PeriodFilter.js';
import {money} from './presentation.js';
import './campaign-workspace.css';
export interface CampaignWorkspaceProps {page:MetaAdsCampaignWorkspacePage|null;query:MetaAdsWorkspaceQuery;loading?:boolean;error?:string;selectedId?:string|null;onQuery(query:MetaAdsWorkspaceQuery):void;onOpen(row:MetaAdsCampaignWorkspaceRow):void;onRetry():void;onCreate():void;actions?:(row:MetaAdsCampaignWorkspaceRow)=>ReactNode}
const filters:Array<[MetaAdsCampaignFilter,string]>=[['all','Todas'],['approval','Aguardando aprovação'],['running','Em veiculação'],['paused','Pausadas'],['drafts','Rascunhos'],['attention','Precisam de atenção'],['archived','Arquivadas']];
const displayDate=(day:string)=>day.slice(0,10).split('-').reverse().join('/');
export function campaignAudience(a:MetaAdsAudienceSummary):string{
 if(a.source==='unavailable'||!a.countries.length)return 'Público não informado';
 const regions=new Intl.DisplayNames(['pt-BR'],{type:'region'}),parts=[a.countries.map(c=>regions.of(c)??c).join(', ')];
 if(a.minimumAge!==null)parts.push(a.maximumAge!==null?`${a.minimumAge} a ${a.maximumAge} anos`:`A partir de ${a.minimumAge} anos`);
 return parts.join(' · ');
}
function Results({row,query}:{row:MetaAdsCampaignWorkspaceRow;query:MetaAdsWorkspaceQuery}){
 const m=row.metrics?.since===query.since&&row.metrics.until===query.until?row.metrics:null,confirmed=m?.confirmedOrdersStatus==='available'||m?.confirmedOrdersStatus===undefined&&!!m?.source.includes('zyon_reconciled');
 const value=(v:number|null|undefined,currency=false)=>v===null||v===undefined?'Indisponível':currency?money(v,m?.currency):v.toLocaleString('pt-BR');
 const revenue=confirmed?m?.confirmedRevenueCents:null;
 return <div className="ads-workspace__results"><dl>
  <div><dt>Valor gasto</dt><dd>{value(m?.spendCents,true)}</dd></div>
  {row.campaign.draft.destination==='whatsapp'?<><div><dt>Conversas iniciadas</dt><dd>{value(m?.conversations)}</dd></div><div><dt>Vendas confirmadas</dt><dd>{value(revenue,true)}</dd></div></>:<><div><dt>Vendas confirmadas</dt><dd>{value(revenue,true)}</dd></div><div><dt>Compras pagas</dt><dd>{value(confirmed?m?.paidOrders:null)}</dd></div></>}
 </dl>{m?.stale?<span className="ads-workspace__data-note">Dados desatualizados</span>:!m?<span className="ads-workspace__data-note">Aguardando dados deste período</span>:null}</div>;
}
export function CampaignWorkspace({page,query,loading=false,error='',selectedId,onQuery,onOpen,onRetry,onCreate,actions}:CampaignWorkspaceProps){
 const change=(patch:Partial<MetaAdsWorkspaceQuery>)=>onQuery({...query,...patch});
 const preset=(key:string)=>{const end=new Date(),start=new Date(end);start.setDate(start.getDate()-Number(key)+1);const day=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;change({since:day(start),until:day(end),page:1});};
 return <section className="ads-workspace dashboard-ui" aria-label="Campanhas da loja" aria-busy={loading}>
  <div className="ads-workspace__heading"><div><h2>Campanhas da loja</h2><p>Acompanhe os resultados e revise o que precisa da sua aprovação.</p></div><button type="button" className="zyn-btn zyn-btn--primary" onClick={onCreate}>Criar campanha</button></div>
  <TabBar role="group" label="Situação das campanhas" activeTab={query.filter} tabs={filters.map(([key,label])=>({key,label:`${label} (${page?.counts[key]??0})`}))} onTabChange={filter=>change({filter:filter as MetaAdsCampaignFilter,page:1})}/>
  <label className="ads-workspace__mobile-filter">Situação<select aria-label="Filtrar situação das campanhas" value={query.filter} onChange={event=>change({filter:event.target.value as MetaAdsCampaignFilter,page:1})}>{filters.map(([key,label])=><option key={key} value={key}>{label} ({page?.counts[key]??0})</option>)}</select></label>
  <div className="ads-workspace__filters"><label className="ads-workspace__search"><Search size={16} aria-hidden="true"/><input aria-label="Buscar campanhas" placeholder="Buscar por campanha ou produto" value={query.search} onChange={event=>change({search:event.target.value,page:1})}/></label><PeriodFilter presets={[{key:'7',label:'7 dias'},{key:'14',label:'14 dias'},{key:'30',label:'30 dias'}]} active="" onPreset={preset} from={query.since} to={query.until} onDate={(field,value)=>change({[field==='from'?'since':'until']:value,page:1})}/></div>
  {error?<div className="ads-workspace__error" role="alert"><span>{error}</span><button type="button" className="zyn-btn zyn-btn--sm" onClick={onRetry} disabled={loading}>Tentar novamente</button></div>:null}
  {!page&&loading?<div className="ads-workspace__loading" role="status"><span>Carregando campanhas…</span>{[1,2,3].map(n=><div className="ads-workspace__skeleton" key={n} aria-hidden="true"/>)}</div>:null}
  {page&&!page.items.length?<div className="ads-workspace__empty"><h3>{query.search||query.filter!=='all'?'Nenhuma campanha neste filtro':'Sua primeira campanha começa aqui'}</h3><p>{query.search||query.filter!=='all'?'Tente outra busca ou escolha outra situação.':'Conte à Zyon o que você quer vender. A IA prepara o anúncio para sua revisão.'}</p>{query.search||query.filter!=='all'?<button type="button" className="zyn-btn" onClick={()=>change({search:'',filter:'all',page:1})}>Limpar filtros</button>:null}</div>:null}
  {page?.items.length?<ul className="ads-workspace__list mga-campaign-list">{page.items.map(row=>{const c=row.campaign,b=c.draft.budget;return <li key={c.id}><article data-campaign-id={c.id} data-selected={selectedId===c.id||undefined} aria-label={c.draft.name}>
   <div className="ads-workspace__identity"><div className="ads-workspace__name"><h3>{c.draft.name}</h3><span className="ads-workspace__state" data-state={row.group}>{row.stateLabel}</span></div><p>{c.products.map(p=>p.name).join(', ')||'Produtos não informados'} · {c.draft.destination==='whatsapp'?'WhatsApp':'Loja'}</p><p className="ads-workspace__audience">{campaignAudience(row.audience)}{row.audience.source!=='unavailable'&&row.audience.countries.length?<> <span>· {row.audience.source==='verified'?'Público confirmado':'Público planejado'}</span></>:null}</p></div>
   <div className="ads-workspace__budget"><span>Investimento</span><strong>{b?`${money(b.amountCents,b.currency)} ${b.cadence==='daily'?'por dia':'no total'}`:'Verba não definida'}</strong>{b?<small>{displayDate(b.startsAt)}{b.endsAt?` a ${displayDate(b.endsAt)}`:''}</small>:null}</div>
   <Results row={row} query={query}/><div className="ads-workspace__actions"><button type="button" className="zyn-btn zyn-btn--sm" aria-label={`Ver campanha ${c.draft.name}`} onClick={()=>onOpen(row)}><span>Abrir campanha<span className="sr-only"> {c.draft.name}</span></span><ChevronRight size={16} aria-hidden="true"/></button>{actions?.(row)}</div>
  </article></li>;})}</ul>:null}
  {page&&page.total>0?<div className="ads-workspace__pagination"><span>{(page.page-1)*10+1}–{Math.min(page.page*10,page.total)} de {page.total} campanhas</span><div><button type="button" className="ui-icon-button" aria-label="Página anterior" disabled={loading||page.page<=1} onClick={()=>change({page:page.page-1})}><ArrowLeft size={18}/></button><span>{page.page} de {page.pages}</span><button type="button" className="ui-icon-button" aria-label="Próxima página" disabled={loading||page.page>=page.pages} onClick={()=>change({page:page.page+1})}><ArrowRight size={18}/></button></div></div>:null}
 </section>;
}
