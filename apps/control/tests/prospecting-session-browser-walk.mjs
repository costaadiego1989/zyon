import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {ensureCampaignPreview} from './prospecting-campaign-flow-preview.mjs';
import {PlatformJwtService} from '../../api/src/modules/platform-control/domain/services/platform-jwt.service.js';
import {PrismaPlatformOperatorRepository} from '../../api/src/modules/platform-control/infrastructure/prisma-platform-operator.repository.js';

// A short-lived real session is issued only in the ownership-checked loopback fixture.
const runtime=await ensureCampaignPreview();
const apiRequire=createRequire(new URL('../../api/package.json',import.meta.url));
apiRequire('reflect-metadata');
const {Pool}=apiRequire('pg'),{PrismaClient}=apiRequire('@prisma/client');
const {chromium,expect}=createRequire(new URL('../package.json',import.meta.url))('@playwright/test');
const config=JSON.parse(readFileSync(new URL('../../../.specs/features/admin-company-prospecting/environment.local.json',import.meta.url),'utf8'));
const url=new URL(config.databaseUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'15438');assert.match(runtime.database,/^prospecting_test_[a-f0-9]{32}$/);url.pathname='/'+runtime.database;url.search='';
const pg=new Pool({connectionString:url.href,max:1});
assert.equal((await pg.query('SELECT owner FROM browser_runtime_owner')).rows[0].owner,runtime.owner);
const prisma=new PrismaClient({datasources:{db:{url:url.href}}});
const jwt=new PlatformJwtService(new PrismaPlatformOperatorRepository(prisma),'local-platform-signing-key-for-browser-only',1);
const folder=new URL('../../../.specs/features/admin-prospecting-max-price-session-ui/',import.meta.url);mkdirSync(new URL('captures/',folder),{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}});
const allowed=new Set(Object.values(runtime.origins));for(const origin of allowed)assert.equal(new URL(origin).hostname,'127.0.0.1');
await context.route('**/*',route=>allowed.has(new URL(route.request().url()).origin)?route.continue():route.abort());
const page=await context.newPage(),responses=[];page.setDefaultTimeout(20000);
page.on('response',r=>{if(r.url().includes('/platform/auth/'))responses.push({path:new URL(r.url()).pathname,status:r.status()});});
let family;
try{
 const account=await prisma.platformOperator.findUniqueOrThrow({where:{id:'local-operator'}});
 const token=await jwt.issue({operatorId:account.id,email:account.email,role:account.role},account.authVersion);
 const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
 family=await prisma.platformAuthSession.findUniqueOrThrow({where:{id:payload.jti}});
 await new Promise(resolve=>setTimeout(resolve,1300));
 const expired=await page.request.get(runtime.origins.api+'/v1/platform/auth/me',{headers:{Authorization:'Bearer '+token}});assert.equal(expired.status(),401);
 await page.goto(runtime.origins.control,{waitUntil:'domcontentloaded'});
 await page.evaluate(session=>sessionStorage.setItem('zyon.platform-control.session.v1',JSON.stringify(session)),{token,operator:{operator_id:account.id,email:account.email,role:account.role}});
 await page.goto(runtime.origins.control+'/#prospecting/campaigns');await page.reload();
 await expect(page.getByRole('heading',{name:'Campanhas',exact:true})).toBeVisible();
 const stored=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('zyon.platform-control.session.v1')));
 assert.notEqual(stored.token,token);assert.deepEqual(stored.operator,{operator_id:account.id,email:account.email,role:account.role});
 assert.equal(responses.filter(r=>r.path.endsWith('/auth/refresh')).length,1,'one refresh despite concurrent expired bootstrap and renewal');
 assert.equal(responses.find(r=>r.path.endsWith('/auth/refresh')).status,201);
 const next=JSON.parse(Buffer.from(stored.token.split('.')[1],'base64url').toString());
 const old=await prisma.platformAuthSession.findUniqueOrThrow({where:{id:payload.jti}}),replacement=await prisma.platformAuthSession.findUniqueOrThrow({where:{id:next.jti}});
 assert.ok(old.consumedAt);assert.equal(replacement.familyId,family.familyId);assert.equal(replacement.refreshExpiresAt.toISOString(),family.refreshExpiresAt.toISOString());
 assert.equal((await page.request.get(runtime.origins.api+'/v1/platform/auth/me',{headers:{Authorization:'Bearer '+stored.token}})).status(),200);
 assert.equal((await context.cookies()).length,0);assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>localStorage.getItem(k).includes('access_token')||localStorage.getItem(k).includes('Bearer '))),false);
 await page.screenshot({path:new URL('captures/session-renewed-1440.running.png',folder).pathname.replace(/^\/(\w:)/,'$1'),fullPage:false});
 writeFileSync(new URL('session-browser-walk.json',folder),JSON.stringify({status:'passed',at:new Date().toISOString(),source:'actual Control, Nest HTTP and owned local PostgreSQL',expiredMeStatus:401,renewalStatus:201,renewals:1,replacementMeStatus:200,sameOperator:true,sameFamily:true,sameRefreshDeadline:true,cookies:0,externalCalls:0},null,2)+'\n');
 console.log(JSON.stringify({status:'passed',expiredMeStatus:401,renewals:1,replacementMeStatus:200,sameFamily:true,sameRefreshDeadline:true,externalCalls:0}));
}finally{
 if(family)await prisma.platformAuthSession.updateMany({where:{familyId:family.familyId},data:{revokedAt:new Date()}});
 await context.close();await browser.close();await prisma.$disconnect();await pg.end();
}
