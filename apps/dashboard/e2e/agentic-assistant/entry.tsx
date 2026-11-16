import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/styles.css';
import {MetaAdsAgentPage} from '../../src/pages/meta-ads-agent/index.js';
declare const __AGENTIC_API__:string;
declare const __AGENTIC_NONCE__:string;
function App(){
  const [merchant,setMerchant]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  async function session(){const response=await fetch(__AGENTIC_API__+'/v1/agentic-test/session',{credentials:'include'});if(response.ok)setMerchant((await response.json()).merchantId);else setMerchant(null);setLoading(false);}
  useEffect(()=>{void session().catch(()=>{setError('API local indisponível');setLoading(false);});},[]);
  async function login(store='store-a'){setLoading(true);setError('');try{const response=await fetch(__AGENTIC_API__+'/__test/login',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-agentic-test-nonce':__AGENTIC_NONCE__},body:JSON.stringify({store})});if(!response.ok)throw Error();await session();}catch{setError('Não foi possível autenticar na loja de teste');setLoading(false);}}
  return <main style={{maxWidth:1120,margin:'0 auto',padding:'16px',minWidth:0}}><header style={{display:'flex',gap:16,alignItems:'center',flexWrap:'wrap',marginBottom:24}}><span>Ambiente local de aceitação</span>{merchant&&<label>Loja ativa<select aria-label="Loja ativa" value={merchant} disabled={loading} onChange={e=>void login(e.target.value)} style={{minHeight:44,marginLeft:8}}><option value="store-a">Loja Aurora</option><option value="store-b">Loja Horizonte</option></select></label>}</header>
    {error&&<p role="alert">{error}</p>}{!merchant?<button type="button" disabled={loading} onClick={()=>void login()} style={{minHeight:44}}>{loading?'Verificando sessão…':'Entrar na loja de teste'}</button>:<MetaAdsAgentPage merchantId={merchant} apiBaseUrl={__AGENTIC_API__}/>}</main>;
}
document.body.style.cssText='overflow:auto;height:auto;min-width:0';document.getElementById('root')!.style.cssText='height:auto;overflow:visible;min-width:0';createRoot(document.getElementById('root')!).render(<App/>);
