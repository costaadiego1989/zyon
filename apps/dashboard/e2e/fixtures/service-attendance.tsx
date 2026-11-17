/** Isolated real component entry; no HTTP, profile, auth or repository mocks. */
import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DashboardHttpError,resolveDashboardApiBaseUrl,type MerchantProfile} from '../../src/api-client.js';
import {ApiContext,useApiInstance} from '../../src/hooks/useApi.js';
import {AuthScreen,type AuthMode} from '../../src/auth/AuthScreen.js';
import {authModeFromUrl,authUrlForMode} from '../../src/auth/auth-navigation.js';
import {friendlyAuthError} from '../../src/auth/auth-error.js';
import {PageLoader} from '../../src/components/PageLoader.js';
import {ServiceAttendancePage} from '../../src/pages/service-attendance/ServiceAttendancePage.js';
import '../../src/styles.css';
import '../../src/components/dashboard-ui.css';
import '../../src/components/tab-bar.css';

function Entry(){
  const api=useApiInstance(resolveDashboardApiBaseUrl(import.meta.env));
  const[me,setMe]=useState<MerchantProfile|null>(null),[profileDenied,setProfileDenied]=useState(false),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[hint,setHint]=useState<string|null>(null);
  const[mode,setMode]=useState<AuthMode>(()=>authModeFromUrl(location.href)),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[merchantName,setMerchantName]=useState(''),[captchaToken,setCaptchaToken]=useState<string|null>(null);
  async function refresh(){setChecking(true);setProfileDenied(false);try{setMe(await api.merchantProfile());}catch(error){setMe(null);setProfileDenied(error instanceof DashboardHttpError&&error.status===403);if(!(error instanceof DashboardHttpError&&error.status===401))setHint(friendlyAuthError(error));}finally{setChecking(false);}}
  useEffect(()=>{void refresh();},[api]);
  return <ApiContext.Provider value={api}>
    <aside style={{position:'sticky',top:0,zIndex:10,padding:'8px 16px',background:'#143d2b',color:'#fff',font:'12px system-ui'}}>Aplicação, API e banco locais · Dados sintéticos · Sem conexão com produção</aside>
    <strong style={{position:'fixed',top:8,right:80,zIndex:1100,padding:'2px 6px',borderRadius:4,background:'#143d2b',color:'#fff',font:'11px/14px system-ui'}}>LOCAL</strong>
    {checking?<PageLoader variant="section"/>:me||profileDenied?<main className="dashboard-ui" style={{maxWidth:1200,margin:'0 auto',padding:'24px clamp(16px,3vw,40px)',minWidth:0}}><ServiceAttendancePage me={me}/></main>:<AuthScreen mode={mode} setMode={next=>{setMode(next);history.replaceState(history.state,'',authUrlForMode(location.href,next));setHint(null);setCaptchaToken(null);}}
      busy={busy} hint={hint} email={email} setEmail={setEmail} password={password} setPassword={setPassword} merchantName={merchantName} setMerchantName={setMerchantName}
      captchaToken={captchaToken} setCaptchaToken={setCaptchaToken} turnstileSiteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY??''}
      onSubmit={event=>{event.preventDefault();if(busy)return;setBusy(true);setHint(null);void(async()=>{try{await api.login(email,password,captchaToken??undefined);await refresh();}catch(error){setHint(friendlyAuthError(error));}finally{setBusy(false);}})();}}
      onRegister={async payload=>{await api.register(payload);}} onSaveTheme={async theme=>{await api.putMerchantTheme(theme);}}
      onSaveCompanyData={async data=>{await api.putStoreSettings(data);}} onSaveOwner={async data=>{await api.updateMe(data);}} onComplete={refresh}/>}</ApiContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Entry/>);
