import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash} from 'node:crypto';

export const REPOSITORY='costaadiego1989/zyon';
export const FORMAT='ZYON_API_CI_TRANSPORT_V1';
export const MARKER='ZYON_API_CI_TRANSPORT_V1=';
export const COMMANDS={checked:['pnpm','--dir','apps/api','build'],'api-types':['pnpm','--filter','@zyon/api','typecheck']};
export const RECEIPT='apps/api/.sandbox-state/service-test-build.json';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const json=bytes=>JSON.parse(bytes.toString('utf8'));
export const digest=value=>assert.match(value,/^[a-f0-9]{64}$/);
export const revision=value=>assert.match(value,/^[a-f0-9]{40}$/);
export const integer=value=>assert.ok(Number.isSafeInteger(value)&&value>0);
const schemaFormatters=new Map();
/** Installed Prisma's canonical DSL formatter, synchronously, with no CLI/import/generation. */
export function canonicalPrismaSchema(workspaceRoot,schemaText,expectedLockedPrismaVersion){
  assert.equal(typeof schemaText,'string');assert.match(expectedLockedPrismaVersion,/^\d+\.\d+\.\d+$/);
  const workspace=path.resolve(workspaceRoot),packageFile=fs.realpathSync(owned(workspace,'apps/api/node_modules/prisma/package.json'));
  const relative=path.relative(workspace,packageFile);assert.ok(relative&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative),'formatter package outside workspace');
  assert.equal(json(fs.readFileSync(packageFile)).version,expectedLockedPrismaVersion,'formatter version differs from locked Prisma');
  const wasmFile=path.join(path.dirname(packageFile),'build/prisma_schema_build_bg.wasm');assert.ok(fs.lstatSync(wasmFile).isFile()&&!fs.lstatSync(wasmFile).isSymbolicLink(),'installed formatter WASM required');
  const wasmBytes=fs.readFileSync(wasmFile),key=expectedLockedPrismaVersion+':'+sha(wasmBytes);let formatter=schemaFormatters.get(key);
  if(!formatter){
    const module=new WebAssembly.Module(wasmBytes),imports={__wbindgen_placeholder__:{}};let wasm;
    const decode=(pointer,length)=>new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(wasm.memory.buffer,pointer,length));
    for(const entry of WebAssembly.Module.imports(module)){
      assert.equal(entry.module,'__wbindgen_placeholder__');assert.equal(entry.kind,'function');
      if(/^__wbg_set_message_/.test(entry.name))imports.__wbindgen_placeholder__[entry.name]=()=>{};
      else if(/^__wbg_Error_/.test(entry.name))imports.__wbindgen_placeholder__[entry.name]=(pointer,length)=>new Error(decode(pointer,length));
      else if(/^__wbg___wbindgen_throw_/.test(entry.name))imports.__wbindgen_placeholder__[entry.name]=(pointer,length)=>{throw new Error(decode(pointer,length));};
      else if(entry.name==='__wbindgen_init_externref_table')imports.__wbindgen_placeholder__[entry.name]=()=>{const table=wasm.__wbindgen_externrefs,index=table.grow(4);table.set(0,undefined);table.set(index,undefined);table.set(index+1,null);table.set(index+2,true);table.set(index+3,false);};
      else assert.fail('unsupported installed Prisma formatter import');
    }
    wasm=new WebAssembly.Instance(module,imports).exports;wasm.__wbindgen_start();
    const encode=value=>{const bytes=Buffer.from(value,'utf8'),pointer=wasm.__wbindgen_malloc(bytes.length,1);new Uint8Array(wasm.memory.buffer).set(bytes,pointer);return[pointer,bytes.length];};
    formatter=value=>{
      const [schemaPointer,schemaLength]=encode(JSON.stringify([['schema.prisma',value]]));
      const [optionsPointer,optionsLength]=encode(JSON.stringify({textDocument:{uri:'file:/dev/null'},options:{tabSize:2,insertSpaces:true}}));
      let result;
      try{result=wasm.format(schemaPointer,schemaLength,optionsPointer,optionsLength);const output=JSON.parse(decode(result[0],result[1]));assert.ok(Array.isArray(output)&&output.length===1&&output[0][0]==='schema.prisma'&&typeof output[0][1]==='string');return output[0][1];}
      finally{if(result)wasm.__wbindgen_free(result[0],result[1],1);}
    };
    schemaFormatters.set(key,formatter);
  }
  try{return formatter(schemaText);}catch(error){throw new Error('prisma_schema_canonicalization_failed version='+expectedLockedPrismaVersion+' schemaSha256='+sha(Buffer.from(schemaText))+' errorSha256='+sha(Buffer.from(String(error?.message??error))));}
}
export function relativeName(value){
  assert.equal(typeof value,'string');assert.ok(value.length>0&&value===value.normalize('NFC'));
  assert.ok(!value.startsWith('/')&&!/[\\<>:"|?*\x00-\x1f\x7f]/.test(value),'unsafe archive path');
  for(const part of value.split('/'))assert.ok(part&&part!=='.'&&part!=='..'&&!/[. ]$/.test(part)
    &&! /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)&&Buffer.byteLength(part)<=255,'unsafe Windows component');
  return value;
}
export function owned(root,name){
  relativeName(name);const target=path.resolve(root,...name.split('/')),rel=path.relative(path.resolve(root),target);
  assert.ok(rel&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));return target;
}
export function noLinks(root,name,{allowMissing=true}={}){
  const base=path.resolve(root);assert.ok(fs.existsSync(base)&&fs.lstatSync(base).isDirectory()&&!fs.lstatSync(base).isSymbolicLink());
  let current=base;
  for(const part of relativeName(name).split('/')){current=path.join(current,part);if(!fs.existsSync(current)){assert.ok(allowMissing);break;}
    assert.equal(fs.lstatSync(current).isSymbolicLink(),false,'symlink/junction forbidden');}
  return owned(base,name);
}
export function hashRange(fd,start,size){
  const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let position=start,left=size;
  while(left){const count=fs.readSync(fd,buffer,0,Math.min(buffer.length,left),position);assert.ok(count>0,'truncated bytes');hash.update(buffer.subarray(0,count));left-=count;position+=count;}
  return hash.digest('hex');
}
export function hashFile(file){const fd=fs.openSync(file,'r');try{return hashRange(fd,0,fs.fstatSync(fd).size);}finally{fs.closeSync(fd);}}
export function rootsFor(workspace){
  const result=['apps/api/dist'];const packages=noLinks(workspace,'packages',{allowMissing:false});
  for(const item of fs.readdirSync(packages,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    assert.equal(item.isSymbolicLink(),false);if(item.isDirectory()&&fs.existsSync(path.join(packages,item.name,'package.json')))
      result.push(relativeName('packages/'+item.name+'/dist'));
  }
  return result.sort();
}
export function isOutput(name,roots){return roots.some(root=>name===root||name.startsWith(root+'/'));}
export function treeEntries(workspace,root,{allowNative=false}={}){
  const target=noLinks(workspace,root);if(!fs.existsSync(target))return [];
  const entries=[];function visit(file,name){const stat=fs.lstatSync(file);assert.equal(stat.isSymbolicLink(),false);relativeName(name);
    if(stat.isDirectory()){entries.push({path:name,kind:'directory',bytes:0});for(const item of fs.readdirSync(file).sort())visit(path.join(file,item),name+'/'+item);}
    else{assert.ok(stat.isFile(),'regular files only');assert.ok(allowNative||!/\.(?:node|dll|exe)$/i.test(name),'native output requires separate review');
      assert.ok(!name.endsWith('/release-v1.json'),'release manifest cannot be transported');entries.push({path:name,kind:'file',bytes:stat.size,sha256:hashFile(file)});}}
  visit(target,root);return entries.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export function treeDigest(workspace,root,options){return sha(Buffer.from(JSON.stringify(treeEntries(workspace,root,options))));}
function put(header,start,length,value){const bytes=Buffer.from(String(value));assert.ok(bytes.length<=length);bytes.copy(header,start);}
function octal(value,width){assert.ok(Number.isSafeInteger(value)&&value>=0);const s=value.toString(8);assert.ok(s.length<width);return s.padStart(width-1,'0')+'\0';}
function headerFor(name,bytes,kind){
  relativeName(name);const header=Buffer.alloc(512);let leaf=name,prefix='';
  if(Buffer.byteLength(leaf)>100){const choices=[...name.matchAll(/\//g)].map(m=>m.index).filter(index=>Buffer.byteLength(name.slice(0,index))<=155&&Buffer.byteLength(name.slice(index+1))<=100);assert.ok(choices.length,'ustar path too long');const index=choices.at(-1);prefix=name.slice(0,index);leaf=name.slice(index+1);}
  put(header,0,100,leaf);put(header,100,8,octal(kind==='directory'?0o755:0o644,8));put(header,108,8,octal(0,8));put(header,116,8,octal(0,8));
  put(header,124,12,octal(bytes,12));put(header,136,12,octal(0,12));header.fill(32,148,156);put(header,156,1,kind==='directory'?'5':'0');
  put(header,257,6,'ustar\0');put(header,263,2,'00');put(header,345,155,prefix);put(header,148,8,header.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ');return header;
}
export function writeTar(destination,entries){
  const fd=fs.openSync(destination,'wx');try{for(const entry of entries){fs.writeSync(fd,headerFor(entry.name,entry.bytes,entry.kind));
    if(entry.kind==='file'){if(entry.buffer)fs.writeSync(fd,entry.buffer);else{const input=fs.openSync(entry.file,'r');try{const buffer=Buffer.alloc(1024*1024);let remaining=entry.bytes;while(remaining){const n=fs.readSync(input,buffer,0,Math.min(buffer.length,remaining),null);assert.ok(n>0);fs.writeSync(fd,buffer,0,n);remaining-=n;}assert.equal(fs.fstatSync(input).size,entry.bytes);}finally{fs.closeSync(input);}}
      const padding=(512-entry.bytes%512)%512;if(padding)fs.writeSync(fd,Buffer.alloc(padding));}}
    fs.writeSync(fd,Buffer.alloc(1024));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return hashFile(destination);
}
const stringField=(buffer,start,length)=>buffer.subarray(start,start+length).toString('utf8').replace(/\0.*$/s,'');
function numberField(buffer,start,length){const value=stringField(buffer,start,length).trim();assert.match(value,/^[0-7]+$/);return parseInt(value,8);}
export function inspectTar(file,maxBytes=4*1024**3){
  const fd=fs.openSync(file,'r');try{const stat=fs.fstatSync(fd);assert.ok(stat.isFile()&&stat.size<=maxBytes&&stat.size>=1024);const entries=[],names=new Map();let offset=0,ended=false;
    while(offset+512<=stat.size){const header=Buffer.alloc(512);assert.equal(fs.readSync(fd,header,0,512,offset),512);
      if(header.every(byte=>byte===0)){const tail=Buffer.alloc(512);assert.equal(fs.readSync(fd,tail,0,512,offset+512),512);assert.ok(tail.every(byte=>byte===0));assert.equal(offset+1024,stat.size,'trailing tar data forbidden');ended=true;break;}
      assert.ok(entries.length<200000);const checksum=numberField(header,148,8),copy=Buffer.from(header);copy.fill(32,148,156);assert.equal(copy.reduce((a,b)=>a+b,0),checksum);
      assert.equal(stringField(header,257,6),'ustar');assert.equal(stringField(header,263,2),'00');assert.equal(stringField(header,157,100),'','links forbidden');
      const prefix=stringField(header,345,155),name=relativeName((prefix?prefix+'/':'')+stringField(header,0,100));
      const folded=name.toLowerCase();assert.ok(!names.has(folded),'duplicate/case-colliding tar entry');names.set(folded,name);
      const type=stringField(header,156,1);assert.ok(type==='0'||type==='5','only regular files/directories; no PAX/GNU/link entries');
      const bytes=numberField(header,124,12);assert.ok(bytes<=1024**3);if(type==='5')assert.equal(bytes,0);const dataOffset=offset+512;
      assert.ok(dataOffset+bytes<=stat.size);entries.push({name,kind:type==='5'?'directory':'file',bytes,offset:dataOffset,...(type==='0'?{sha256:hashRange(fd,dataOffset,bytes)}:{})});
      offset=dataOffset+Math.ceil(bytes/512)*512;
    }
    assert.ok(ended,'unterminated archive');const byName=new Map(entries.map(x=>[x.name.toLowerCase(),x]));for(const item of entries){let parent=item.name;while(parent.includes('/')){parent=parent.slice(0,parent.lastIndexOf('/'));const entry=byName.get(parent.toLowerCase());assert.ok(!entry||entry.kind==='directory','file used as parent');}}
    return{fd,entries,bytes:stat.size,sha256:hashRange(fd,0,stat.size),identity:{dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs}};
  }catch(error){fs.closeSync(fd);throw error;}
}
export function readEntry(archive,name,limit=1024*1024){const entry=archive.entries.find(x=>x.name===name);assert.ok(entry&&entry.kind==='file'&&entry.bytes<=limit);const bytes=Buffer.alloc(entry.bytes);assert.equal(fs.readSync(archive.fd,bytes,0,bytes.length,entry.offset),bytes.length);return bytes;}
export function copyEntry(archive,entry,destination){
  fs.mkdirSync(path.dirname(destination),{recursive:true});if(entry.kind==='directory'){fs.mkdirSync(destination,{recursive:true});return;}
  const fd=fs.openSync(destination,'wx');try{const buffer=Buffer.alloc(1024*1024);let offset=entry.offset,left=entry.bytes;while(left){const n=fs.readSync(archive.fd,buffer,0,Math.min(left,buffer.length),offset);assert.ok(n>0);fs.writeSync(fd,buffer,0,n);offset+=n;left-=n;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}assert.equal(hashFile(destination),entry.sha256);
}
export function checkReceipt(bytes,inputSha256){const receipt=json(bytes);assert.equal(receipt.version,1);assert.equal(receipt.buildCommand,'pnpm --dir apps/api build');assert.equal(receipt.buildExitCode,0);assert.equal(receipt.checked,true);assert.equal(receipt.compilerCoverage?.checked,true);integer(receipt.compilerCoverage.sourceCount);digest(receipt.inputSha256);digest(receipt.artifactSha256);assert.equal(receipt.inputSha256,inputSha256);return receipt;}
export function verifyBundle(archive,expected){
  const bytes=readEntry(archive,'metadata/ci-api.json',16*1024**2),metadata=json(bytes);assert.equal(metadata.format,FORMAT);assert.equal(metadata.repository,REPOSITORY);revision(metadata.head);assert.equal(metadata.head,expected.head);assert.equal(metadata.inputSha256,expected.inputSha256);digest(metadata.inputSha256);
  assert.deepEqual(metadata.outputRoots.map(x=>x.path),expected.outputRoots);assert.ok(metadata.outputRoots.every(x=>typeof x.exists==='boolean'));
  assert.deepEqual(metadata.gates.map(x=>x.id).sort(),Object.keys(COMMANDS).sort());
  const allowed=new Set(['metadata/ci-api.json','metadata/checked-build.json','metadata/checked-inputs.json','metadata/source-input-evidence.json']);
  for(const gate of metadata.gates){assert.deepEqual(gate.argv,COMMANDS[gate.id]);assert.equal(gate.cwd,'.');assert.equal(gate.exitCode,0);integer(gate.stepNumber);assert.ok(gate.stepName?.trim());
    for(const stream of ['stdout','stderr']){const name='logs/'+gate.id+'.'+stream+'.txt';allowed.add(name);const entry=archive.entries.find(x=>x.name===name);assert.ok(entry&&entry.kind==='file');assert.equal(entry.sha256,gate[stream].sha256);assert.equal(entry.bytes,gate[stream].bytes);}}
  const payload=archive.entries.filter(x=>x.name.startsWith('payload/')).map(x=>({path:x.name.slice(8),kind:x.kind,bytes:x.bytes,...(x.kind==='file'?{sha256:x.sha256}:{})}));
  assert.deepEqual(payload,metadata.outputs);for(const entry of payload){relativeName(entry.path);assert.ok(isOutput(entry.path,expected.outputRoots),'output outside exact dist roots');assert.ok(!/\.(?:node|dll|exe)$/i.test(entry.path),'native output requires separate review');assert.ok(!entry.path.endsWith('/release-v1.json'));allowed.add('payload/'+entry.path);}
  for(const root of metadata.outputRoots)assert.equal(payload.some(x=>x.path===root.path&&x.kind==='directory'),root.exists,'incomplete root declaration');
  assert.ok(archive.entries.every(x=>allowed.has(x.name)),'unexpected archive entry');
  const receiptBytes=readEntry(archive,'metadata/checked-build.json');assert.equal(sha(receiptBytes),metadata.checkedReceiptSha256);const receipt=checkReceipt(receiptBytes,expected.inputSha256);
  const inputStamp=readEntry(archive,'metadata/checked-inputs.json');assert.equal(sha(inputStamp),metadata.inputStampSha256);assert.equal(json(inputStamp).inputSha256,expected.inputSha256);
  const sourceEvidence=readEntry(archive,'metadata/source-input-evidence.json',16*1024**2);assert.equal(sha(sourceEvidence),metadata.sourceEvidenceSha256);assert.equal(json(sourceEvidence).generatedClients?.length,2);
  assert.equal(receipt.artifactSha256,metadata.checkedArtifactSha256);return{metadata,metadataBytes:bytes,receiptBytes};
}
