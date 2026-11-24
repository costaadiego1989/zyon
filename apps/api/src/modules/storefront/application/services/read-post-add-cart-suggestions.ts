import {conversationBlockSchema} from '../../domain/contracts/conversation-block.schemas.js';
import type {StorefrontConversationPort} from '../../domain/ports/conversation.port.js';
import type {ConversationBlock} from '../../domain/types/conversation-block.js';
type Input={merchantId:string;cartId:string;variantId:string;cart:{merchantId:string;sessionId:string;items:Array<{variantId:string;quantity:number}>}};
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,191}$/.test(value);
/** Existing same-cart post-add read only; never an add/write/accept retry. */
export async function readPostAddCartSuggestions(input:Input,port:Pick<StorefrontConversationPort,'postCartSuggestions'>|undefined){
  const {merchantId,cartId,variantId}=input;
  if(!identifier(merchantId)||!identifier(cartId)||!identifier(variantId)||input.cart.merchantId!==merchantId||input.cart.sessionId!==cartId
    ||!Array.isArray(input.cart.items)||!input.cart.items.some(item=>item.variantId===variantId&&Number.isInteger(item.quantity)&&item.quantity>0))throw Error('post_add_context_invalid');
  const scope=Object.freeze({merchantId,cartId,addedVariantId:variantId});
  try{
    const result=await port?.postCartSuggestions?.(scope),parsed=conversationBlockSchema.safeParse(result);
    if(!parsed.success||parsed.data.type!=='cross_sell')return undefined;
    return parsed.data as Extract<ConversationBlock,{type:'cross_sell'}>;
  }catch{return undefined;} // A failed follow-up never changes the committed acceptance.
}