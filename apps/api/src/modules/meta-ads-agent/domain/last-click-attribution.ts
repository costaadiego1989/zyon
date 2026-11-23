import {MetaAdsError,type AttributionTouch} from './types.js';
interface Input {merchantId:string;sessionIds:string[];paidAt:string;touches:AttributionTouch[]}
/** Identity validation happens at ingress; this function only accepts bound server evidence. */
export function resolveLastClick(input:Input):AttributionTouch|null{
 const end=Date.parse(input.paidAt),start=end-168*3600000;
 if(!Number.isFinite(end))throw new MetaAdsError('attribution_payment_invalid');
 let latest:AttributionTouch|null=null;
 for(const touch of input.touches){
  const at=Date.parse(touch.observedAt);
  if(touch.merchantId!==input.merchantId||!input.sessionIds.includes(touch.sessionId)||!touch.campaignId||!Number.isFinite(at)||at<start||at>end||!Number.isSafeInteger(touch.observationSequence)||touch.observationSequence<1)continue;
  if(!latest||at>Date.parse(latest.observedAt)||at===Date.parse(latest.observedAt)&&touch.observationSequence>latest.observationSequence)latest=touch;
 }
 return latest;
}
