import assert from 'node:assert/strict';
import {MODULE_METADATA} from '@nestjs/common/constants.js';

const email=value=>typeof value==='string'&&/^[a-z0-9._+-]{1,96}@buyer-journey\.example\.test$/.test(value);
const run=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);

/** Optional local transport only. Generation, persistence, verification and
 * buyer sessions are still the original application implementations. */
export function createBuyerBrowserEmailCapture(runId,onDelivery){
  assert.ok(run(runId)&&typeof onDelivery==='function','buyer_browser_capture_scope_required');
  let closed=false,count=0;
  const sender=Object.freeze({async send(recipient,code,context){
    assert.ok(!closed&&email(recipient)&&/^\d{6}$/.test(code),'buyer_browser_delivery_scope_invalid');
    assert.ok(count<20,'buyer_browser_delivery_bound');
    // Emitted only after the original use case has generated and invoked send.
    // The original use case saves its hash only after this call resolves.
    onDelivery({type:'local_buyer_browser_email',runId,sequence:++count,email:recipient,code,
      ...(typeof context?.merchantName==='string'?{merchantName:context.merchantName.slice(0,200)}:{})});
  }});
  return Object.freeze({sender,
    install(module,token){
      const original=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,module);
      assert.ok(Array.isArray(original),'buyer_browser_module_metadata_required');
      const entries=original.filter(row=>row&&typeof row==='object'&&row.provide===token);
      assert.equal(entries.length,1,'buyer_browser_exact_email_provider_required');
      const replacement=original.map(row=>row===entries[0]?{provide:token,useValue:sender}:row);
      Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,replacement,module);let restored=false;
      return Object.freeze({restore(){if(restored)return;
        assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,module),replacement,'buyer_browser_metadata_changed');
        Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,original,module);restored=true;
        assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,module),original);
      }});
    },
    evidence:()=>({capturedEmailCount:count,externalEmailDeliveries:0}),
    close(){closed=true;},
  });
}

/** Private parent mailbox. No HTTP route is installed by this module. */
export function createBuyerBrowserMailbox(runId){
  assert.ok(run(runId),'buyer_browser_mailbox_scope_required');
  let sequence=0,closed=false;const latest=new Map();
  return Object.freeze({
    accept(message){
      assert.ok(!closed&&message?.type==='local_buyer_browser_email'&&message.runId===runId
        &&message.sequence===sequence+1&&sequence<20&&email(message.email)&&/^\d{6}$/.test(message.code)
        &&Object.keys(message).every(key=>['type','runId','sequence','email','code','merchantName'].includes(key))
        &&(message.merchantName===undefined||typeof message.merchantName==='string'&&message.merchantName.length<=200),
      'buyer_browser_mailbox_message_invalid');
      sequence++;latest.set(message.email,{code:message.code,sequence});
    },
    codeFor(recipient){assert.ok(!closed&&email(recipient),'buyer_browser_mailbox_recipient_invalid');
      const row=latest.get(recipient);assert.ok(row,'buyer_browser_delivery_not_observed');return{...row};},
    evidence:()=>({capturedEmailCount:sequence,externalEmailDeliveries:0}),
    close(){closed=true;latest.clear();},
  });
}
