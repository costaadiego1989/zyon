import './zyon-agent-orb.css';
/** Same sphere and blinking eyes used by the storefront and store appearance preview. */
export function ZyonAgentOrb({size=48}:{size?:number}){
 return <span className="zyon-agent-orb" aria-hidden="true" style={{width:size,height:size}}>
  <span className="zyon-agent-orb__sphere"/>
  <span className="zyon-agent-orb__eyes" style={{gap:Math.max(3,Math.round(size*.102))}}>
   <span style={{width:Math.max(3,Math.round(size*.086)),height:Math.max(4,Math.round(size*.125))}}/>
   <span style={{width:Math.max(3,Math.round(size*.086)),height:Math.max(4,Math.round(size*.125))}}/>
  </span>
 </span>;
}
