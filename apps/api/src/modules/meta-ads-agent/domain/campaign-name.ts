import type {MetaAdsCampaignDraft,MetaAdsProduct} from '@zyon/shared-types';
import {MetaAdsError} from './types.js';

const goals={paid_sales:'Mais vendas',cost_per_purchase:'Menor custo por compra',roas:'Retorno em vendas',contribution:'Resultado da loja'};

export function campaignName(input:Pick<MetaAdsCampaignDraft,'priority'|'destination'>&{name?:string|null;products:ReadonlyArray<Pick<MetaAdsProduct,'name'>>}):string{
 if(input.name?.trim())return input.name.trim();
 const first=input.products[0]?.name.trim();
 if(!first)throw new MetaAdsError('campaign_products_required');
 const extra=input.products.length-1;
 const product=first+(extra?` + ${extra} ${extra===1?'produto':'produtos'}`:'');
 const suffix=` · ${goals[input.priority]} · ${input.destination==='store'?'Loja':'WhatsApp'}`;
 const room=120-suffix.length;
 if(product.length<=room)return product+suffix;
 let prefix='';
 for(const character of product){if(prefix.length+character.length>room-1)break;prefix+=character;}
 return prefix.trimEnd()+'…'+suffix;
}
