import {createHash} from 'node:crypto';
import type {WhatsAppTemplateRecord} from '../ports/whatsapp-template-repository.port.js';
/** Bind the exact provider body and semantics, independently of JSON object key order. */
export function templateDispatchDigest(template:Pick<WhatsAppTemplateRecord,'metaTemplateBody'|'metaVariableMap'|'metaCategory'|'metaLanguage'>):string{
  return createHash('sha256').update(JSON.stringify({body:template.metaTemplateBody,variables:Object.entries(template.metaVariableMap??{}).sort(([a],[b])=>a.localeCompare(b)),category:template.metaCategory,language:template.metaLanguage??'pt_BR'})).digest('hex');
}
