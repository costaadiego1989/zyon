export const NOTIFICATION_TYPES = ["ai_strategy_suggestion", "ai_rule_suggestion", "inventory_alert", "plan_expiry", "handoff", "message", "return_requested", "chargeback_opened", "hold_released", "refund_processed", "order_paid", "shipping_wallet_low_balance", "campaign_ready"] as const;
export interface CampaignReviewTarget{merchantId:string;campaignId:string;proposalId:string;}
export interface NotificationItem {
  id: string;
  type: typeof NOTIFICATION_TYPES[number];
  title: string;
  body?: string;
  createdAt: string;
  hypothesisId?: string;
  ticketId?: string;
  inventoryAlertId?: string;
  inventoryItemId?: string;
  sku?: string;
  campaignReview?:CampaignReviewTarget;
}
function textField(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
export function mapInboxNotification(value: unknown): NotificationItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!textField(item.id) || !textField(item.title)) return null;
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata as Record<string, unknown> : {};
  return {
    id: item.id as string,
    type: NOTIFICATION_TYPES.includes(item.type as NotificationItem["type"]) ? item.type as NotificationItem["type"] : "message",
    title: item.title as string,
    body: textField(item.body),
    createdAt: textField(item.createdAt) ?? "",
    hypothesisId: textField(metadata.hypothesisId),
    inventoryAlertId: textField(metadata.inventoryAlertId),
    inventoryItemId: textField(metadata.itemId),
    sku: textField(metadata.sku),
    campaignReview:item.type==='campaign_ready'?reviewTarget(metadata):undefined,
  };
}
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
function reviewTarget(value:Record<string,unknown>):CampaignReviewTarget|undefined {
  return identifier(value.merchantId)&&identifier(value.campaignId)&&identifier(value.proposalId)?{merchantId:value.merchantId,campaignId:value.campaignId,proposalId:value.proposalId}:undefined;
}
export function campaignReviewHash(item:NotificationItem,merchantId:string,role:string):string|null {
  const target=item.campaignReview;
  if(item.type!=='campaign_ready'||!target||target.merchantId!==merchantId||!['OWNER','ADMIN'].includes(role))return null;
  if(!reviewTarget({...target}))return null;
  return `#meta-ads-agent?${new URLSearchParams({store:target.merchantId,campaign:target.campaignId,proposal:target.proposalId})}`;
}
export function campaignReviewLocation(hash:string,merchantId:string,role:string):{target:CampaignReviewTarget|null;error:string} {
  const [page,query]=hash.replace(/^#/,'').split('?');
  if(page!=='meta-ads-agent'||!query)return{target:null,error:''};
  const params=new URLSearchParams(query);
  if(!['store','campaign','proposal'].some(key=>params.has(key)))return{target:null,error:''};
  const target=reviewTarget({merchantId:params.get('store'),campaignId:params.get('campaign'),proposalId:params.get('proposal')});
  if(!target||['store','campaign','proposal'].some(key=>params.getAll(key).length!==1))return{target:null,error:'O link de revisão é inválido.'};
  if(target.merchantId!==merchantId)return{target:null,error:'Esta revisão pertence a outra loja. Selecione a loja correta no dashboard.'};
  if(!['OWNER','ADMIN'].includes(role))return{target:null,error:'Somente administradores podem revisar campanhas.'};
  return{target,error:''};
}
export function notificationDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Data indisponível";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
