import type {MetaAdsConnection} from '@zyon/shared-types';

export function MetaConnectionBadge({status}:{status:MetaAdsConnection['status']}) {
  const connected=status==='connected';
  const label=connected?'Conectado':status==='limited'?'Conectado com ajustes':status==='authorizing'?'Conectando':status==='reconnect_required'?'Conexão expirada':'Não conectado';
  return <span role="status" className={`mga-connection-badge${connected?' mga-connection-badge--connected':''}`}><span className="mga-connection-dot" aria-hidden="true"/>{label}</span>;
}
