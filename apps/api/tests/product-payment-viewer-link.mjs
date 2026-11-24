/** Test viewer only. No provider/network/action dispatch. */
export function capturedPaymentLink(wire){
  const interactive=wire?.interactive,parameters=interactive?.action?.parameters;
  if(interactive?.type!=='cta_url'||interactive.action?.name!=='cta_url'||!parameters||
    typeof parameters.display_text!=='string'||!parameters.display_text.trim()||parameters.display_text.length>100||
    typeof parameters.url!=='string'||parameters.url.length>2048)return undefined;
  try{const url=new URL(parameters.url);
    if(url.protocol!=='https:'||url.hostname!=='sandbox.asaas.com'||url.port||url.username||url.password||url.search||url.hash||
      !/^\/i\/[A-Za-z0-9_-]+$/.test(url.pathname))return undefined;
    return{title:parameters.display_text,url:url.href};
  }catch{return undefined;}
}
export function paymentViewerDocument(html){
  const marker='log.append(article);';
  if(html.indexOf(marker)<0||html.indexOf(marker)!==html.lastIndexOf(marker))throw Error('payment_viewer_anchor_changed');
  return html.replace(marker,"if(entry.paymentLink){const anchor=document.createElement('a');anchor.textContent=entry.paymentLink.title;anchor.href=entry.paymentLink.url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.dataset.capturedPaymentLink='true';article.append(anchor);}"+marker);
}
