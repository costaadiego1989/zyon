import assert from "node:assert/strict";
import test from "node:test";
import { csvCell } from "./ai-costs.reader.js";
import { decimalMicros, estimateCost, normalizeUsage, providerName, ratesAt } from "./usage.js";

test("metadata distinguishes missing usage, explicit zero, invalid counts and embeddings",()=>{
  assert.equal(normalizeUsage({}),undefined);
  assert.equal(normalizeUsage({usage:{prompt_tokens:12}}),undefined);
  assert.equal(normalizeUsage({usage:{input_tokens:3,output_tokens:2,total_tokens:6}}),undefined);
  assert.equal(normalizeUsage({usage:{input_tokens:-1,output_tokens:2}}),undefined);
  assert.equal(normalizeUsage({usage:{input_tokens:0,output_tokens:0,total_tokens:0}})?.total,0);
  assert.equal(normalizeUsage({usage:{prompt_tokens:10,total_tokens:10}},true)?.output,0);
  assert.deepEqual(normalizeUsage({usage_metadata:{input_tokens:100,output_tokens:20,total_tokens:120,input_token_details:{cache_read:40},output_token_details:{reasoning:10}}}),{input:100,output:20,total:120,inputDetails:{cache_read:40},outputDetails:{reasoning:10}});
});
test("fixed decimal costs preserve sub-cent amounts and reject invalid provider costs",()=>{
  assert.equal(decimalMicros("0.0000011"),2n);assert.equal(decimalMicros("0"),0n);assert.equal(decimalMicros(-1),undefined);assert.equal(decimalMicros("NaN"),undefined);
  assert.equal(decimalMicros("123456789.123456"),123456789123456n);
  assert.equal(decimalMicros(1e-8),1n);assert.equal(decimalMicros("1e30"),undefined);
});
test("cache and reasoning are subsets, never charged twice",()=>{
  const u=normalizeUsage({usage:{prompt_tokens:1000,completion_tokens:100,total_tokens:1100,prompt_tokens_details:{cached_tokens:200},completion_tokens_details:{reasoning_tokens:50}}})!;
  assert.equal(estimateCost(u,{input:"150000",cached:"75000",output:"600000"}),195n);
  assert.equal(estimateCost(u,{input:"150000",output:"600000"}),undefined);
});
test("realtime prices text and audio with their own cache rates and requires cache allocation",()=>{
  const rates={input:"600000",cached:"60000",output:"2400000",audio_input:"10000000",audio_cached:"300000",audio_output:"20000000"};
  const u=normalizeUsage({usage:{input_tokens:130,output_tokens:60,total_tokens:190,input_token_details:{text_tokens:100,audio_tokens:30,cached_tokens:0},output_token_details:{text_tokens:40,audio_tokens:20}}})!;
  assert.equal(estimateCost(u,rates),856n);
  const cached={...u,inputDetails:{...u.inputDetails,cached_tokens:20}};assert.equal(estimateCost(cached,rates),undefined);
  cached.inputDetails={...cached.inputDetails,cached_text_tokens:10,cached_audio_tokens:10} as any;assert.equal(estimateCost(cached,rates),754n);
});
test("weekday peak rates use UTC and fixed-decimal multiplication",()=>{
  const rates={input:"150000",cached:"3000",output:"600000",peak_multiplier:"2"};
  assert.equal(ratesAt(rates,new Date("2026-10-19T01:00:00Z")).input,"300000");
  assert.equal(ratesAt(rates,new Date("2026-10-19T04:00:00Z")).input,"150000");
  assert.equal(ratesAt(rates,new Date("2026-10-18T02:00:00Z")).input,"150000");
});
test("provider identity uses endpoint host and CSV neutralizes formulas",()=>{
  assert.equal(providerName("https://api.deepseek.com/v1/chat/completions"),"deepseek");
  assert.equal(csvCell("=1+1"),'"\'=1+1"');assert.equal(csvCell('A "B"'),'"A ""B"""');
});
