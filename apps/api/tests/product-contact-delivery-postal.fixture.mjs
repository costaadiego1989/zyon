import assert from 'node:assert/strict';
const postal=Object.freeze({
  '01310100':Object.freeze({cep:'01310-100',logradouro:'Rua Casa Sintética',bairro:'Centro',localidade:'São Paulo',uf:'SP'}),
  '01310200':Object.freeze({cep:'01310-200',logradouro:'Rua Trabalho Sintético',bairro:'Jardins',localidade:'São Paulo',uf:'SP'}),
});
/** Test transport only. Same HttpClientService instance/retry/circuit/timeouts;
 * only its existing third transport argument is selected for two fixed URLs. */
export function createOwnedPostalTransport(runId,onDelivery){
  assert.match(runId,/^[a-f0-9-]{36}$/);assert.equal(typeof onDelivery,'function');
  let count=0,closed=false,owned;
  const captured=async(input,init={})=>{
    const match=typeof input==='string'&&input.match(/^https:\/\/viacep\.com\.br\/ws\/(01310100|01310200)\/json\/$/);
    assert.ok(!closed&&match&&(init.method??'GET')==='GET'&&init.body===undefined&&init.signal instanceof AbortSignal
      &&![...new Headers(init.headers).keys()].some(key=>/authorization|token|api-key|cookie/i.test(key)),'postal_fixture_request_invalid');
    assert.ok(count<20,'postal_fixture_delivery_bound');const zip=match[1];
    onDelivery({runId,kind:'capturedPostalLookup',sequence:++count,zip,method:'GET'});
    return Response.json(postal[zip]);
  };
  return Object.freeze({
    install(client){
      assert.ok(!closed&&!owned&&client&&typeof client.fetch==='function'&&typeof client.toFetch==='function','postal_fixture_instance_invalid');
      const previous=client.fetch,descriptor=Object.getOwnPropertyDescriptor(client,'fetch');
      const replacement=function(url,options,transport){
        const target=typeof url==='string'&&/^https:\/\/viacep\.com\.br\/ws\/(01310100|01310200)\/json\/$/.test(url);
        return previous.call(this,url,options,target?captured:transport);
      };
      Object.defineProperty(client,'fetch',{configurable:true,writable:true,value:replacement});let restored=false;
      const restore=()=>{if(restored)return;assert.equal(client.fetch,replacement,'postal_fixture_owner_changed');
        if(descriptor)Object.defineProperty(client,'fetch',descriptor);else Reflect.deleteProperty(client,'fetch');restored=true;assert.equal(client.fetch,previous);};
      owned={restore};return Object.freeze(owned);
    },
    evidence:()=>({capturedPostalLookups:count,externalPostalCalls:0}),
    close(){owned?.restore();closed=true;},
  });
}

/** Closed optional test-only composition; existing validators still own every
 * other field and all production/ambient authorization remains unchanged. */
export function validateOwnedPostalFixtureOptions(options){
  if(options?.postalFixture===undefined)return undefined;
  assert.ok(options.local===true&&options.postalFixture==='owned-two-zips-v1'&&options.storefrontQueryModel===true&&options.storefrontRoutingProfile==='structured'
    &&!options.graph&&!options.supportQueryModel&&!options.observeBusinessRag,'postal_fixture_options_invalid');
  const next=options.buyerBooking===true&&options.buyerBrowser===true&&!options.whatsapp;
  const whatsapp=!!options.whatsapp&&!options.buyerBooking&&!options.buyerBrowser;
  assert.ok(next||whatsapp,'postal_fixture_channel_invalid');return options.postalFixture;
}
