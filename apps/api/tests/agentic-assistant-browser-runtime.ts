// Test entrypoint only. Validate controls before importing Nest, Prisma or providers.
const nonce=process.env.AGENTIC_TEST_NONCE??'';
if(!/^[a-f0-9]{64}$/.test(nonce))throw new Error('agentic_test_nonce_required');
if(process.env.NODE_ENV!=='test')throw new Error('agentic_test_environment_required');
const raw=process.env.AGENTIC_TEST_PORT??'3019';
if(!/^\d{4,5}$/.test(raw)||Number(raw)<1024||Number(raw)>65535)throw new Error('agentic_test_port_invalid');
const context=process.env.AGENTIC_TEST_CONTEXT??'meta-ads';
if(!['meta-ads','cashback'].includes(context))throw Error('agentic_test_context_invalid');
const {startAgenticBrowserApp}=await import('./agentic-assistant-browser-app.js');
await startAgenticBrowserApp({nonce,port:Number(raw)});
