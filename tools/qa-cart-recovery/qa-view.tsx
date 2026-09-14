import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/styles.css';
import { ApiContext } from '/src/hooks/useApi.ts';
import { createDashboardApi } from '/src/api-client.ts';
import { CartRecoveryPage } from '/src/pages/cart-recovery/CartRecoveryPage.tsx';
import { TabBar } from '/src/components/TabBar.tsx';
import { FilterToolbar } from '/src/components/FilterToolbar.tsx';
import { EmptyState } from '/src/components/EmptyState.tsx';
import { RulesList } from '/src/pages/checkout-settings/components/RulesList.tsx';
import { SupportFaqTab } from '/src/pages/support-settings/tabs/SupportFaqTab.tsx';
const apiBaseUrl = 'http://127.0.0.1:5198/mock';
const api = createDashboardApi({ baseUrl: apiBaseUrl });
const merchant = { id: 'merchant-qa', name: 'Loja de testes', plan: 'growth' } as any;
function Primitives() {
  const [tab, setTab] = useState('one');
  const tabs = ['Visão geral', 'Mensagens', 'Clientes', 'Configurações', 'Histórico'].map((label, i) => ({key: ['one','two','three','four','five'][i], label}));
  return <>
    <div className="page-container" data-layout="flex"><header className="page-head"><div><span className="eyebrow">Loja</span><h1>Consistência visual</h1><p className="page-lead">Cabeçalho, divisor e conteúdo.</p></div></header><div data-after-header><TabBar tabs={tabs} activeTab={tab} onTabChange={setTab}/></div><RulesList rules={[]} busy={false} onAdd={()=>{}} onEdit={()=>{}} onDelete={()=>{}} onToggle={()=>{}} onReorder={()=>{}} /></div>
    <div data-layout="block" style={{marginTop:32}}><header className="page-head"><div><span className="eyebrow">Loja</span><h1>Consistência visual</h1><p className="page-lead">Cabeçalho, divisor e conteúdo.</p></div></header><div data-after-header><FilterToolbar tabs={tabs} activeTab={tab} onTabChange={setTab} /></div><EmptyState title="Nenhum resultado" description="Ajuste os filtros para encontrar o que procura." /></div>
  </>;
}
function App() {
  const surface = new URLSearchParams(location.search).get('surface');
  return <ApiContext.Provider value={api}><main style={{padding: '24px', maxWidth:1440, margin:'auto', minWidth:0}}>
    {surface === 'primitives' ? <Primitives/> : surface === 'faq' ? <SupportFaqTab api={api}/> : <CartRecoveryPage apiBaseUrl={apiBaseUrl} me={merchant}/>}
  </main></ApiContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<App/>);
