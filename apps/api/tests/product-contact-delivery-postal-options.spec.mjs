import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOwnedPostalFixtureOptions} from './product-contact-delivery-postal.fixture.mjs';
const base={local:true,storefrontQueryModel:true,storefrontRoutingProfile:'structured',postalFixture:'owned-two-zips-v1'};
test('S4 omitted postal fixture leaves the old composition unchanged',()=>{for(const options of[{}, {local:true}, {whatsapp:true}, {buyerBooking:true}])assert.equal(validateOwnedPostalFixtureOptions(options),undefined);});
test('S4 the closed postal fixture permits only the existing structured Next or signed-WA composition',()=>{
  assert.equal(validateOwnedPostalFixtureOptions({...base,buyerBooking:true,buyerBrowser:true}),'owned-two-zips-v1');assert.equal(validateOwnedPostalFixtureOptions({...base,whatsapp:true}),'owned-two-zips-v1');
});
test('S4 unknown flags and graph/support/mixed-channel/unconfigured profiles cannot activate postal transport',()=>{
  for(const patch of[{postalFixture:true},{postalFixture:'any-url'},{storefrontRoutingProfile:undefined},{storefrontQueryModel:undefined},{supportQueryModel:true},{graph:true},{observeBusinessRag:true},
    {buyerBooking:true,buyerBrowser:true,whatsapp:true},{buyerBrowser:true},{buyerBooking:true}])assert.throws(()=>validateOwnedPostalFixtureOptions({...base,...patch}));
});
