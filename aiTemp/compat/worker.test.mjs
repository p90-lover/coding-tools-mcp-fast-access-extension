import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as lib from '../../lib.mjs';
const root = new URL('../../', import.meta.url);
const source = fs.readFileSync(new URL('background.js', root), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
const callback = 'https://chatgpt.com/connector/oauth/fixture_id';
const authorization = new URL('https://fixture.trycloudflare.com/oauth/authorize');
for (const [key,value] of Object.entries({response_type:'code',client_id:'fixture-client',redirect_uri:callback,state:'fixture-state',code_challenge:'x'.repeat(43),code_challenge_method:'S256'})) authorization.searchParams.set(key,value);
const makeJob = (phase='waiting_oauth_or_create') => ({id:'fixture-job',appName:lib.APP_NAME,authType:'oauth',autoAuthorize:true,oauthClientId:'fixture-client',oauthPassword:'synthetic-password-not-real',oauthAuthorizeUrl:authorization.origin+authorization.pathname,chatGptTabId:1,phase,createdAt:Date.now(),updatedAt:Date.now()});
function worker(job) {
  const data={activeSyncJob:structuredClone(job)},local={};
  const tabs=new Map([[1,{id:1,url:'https://chatgpt.com/plugins?view=personal',status:'complete'}],[2,{id:2,url:authorization.href,status:'complete',openerTabId:1}]]);
  let listener;
  const event=()=>({addListener(){},removeListener(){}});
  const store=values=>({get:async defaults=>({...structuredClone(defaults),...structuredClone(values)}),set:async next=>Object.assign(values,structuredClone(next)),remove:async key=>{delete values[key];}});
  const chrome={runtime:{id:'fixture-extension',getURL:p=>'chrome-extension://fixture-extension/'+p,onInstalled:event(),onStartup:event(),onMessage:{addListener(fn){listener=fn;}}},storage:{session:store(data),local:store(local)},alarms:{onAlarm:event(),clear:async()=>true},tabs:{onUpdated:event(),get:async id=>{if(!tabs.has(id))throw Error('missing tab');return structuredClone(tabs.get(id));},sendMessage:async(id,msg)=>msg.type==='CODING_TOOLS_MCP_PING'?{ok:true,version:manifest.version}:{ok:false,stage:'verification_pending'}},permissions:{contains:async()=>true},scripting:{executeScript:async()=>{}},extension:{isAllowedFileSchemeAccess:fn=>fn(false)}};
  const context=vm.createContext({...lib,chrome,URL,console,setTimeout,clearTimeout,structuredClone,Date,crypto:globalThis.crypto});
  vm.runInContext(source.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/lib\.mjs';\s*/,'')+'\nglobalThis.api={resumeActiveJob,handleOauthReady,handleOauthSubmitted,handleChatGptResult,observeOAuthNavigation:typeof observeOAuthNavigation===\'function\'?observeOAuthNavigation:null};',context);
  return {api:context.api,data,local,tabs,send:(msg,sender)=>new Promise(resolve=>listener(msg,sender,resolve))};
}
const sender=(url=authorization.href)=>({id:'fixture-extension',frameId:0,url,origin:new URL(url).origin,tab:{id:2,url,openerTabId:1}});
const parentSender=()=>({id:'fixture-extension',frameId:0,url:'https://chatgpt.com/plugins?view=personal',tab:{id:1}});

test('OAuth popup submission cannot complete from the unchanged parent or an unverified page result',async()=>{
  const w=worker(makeJob('oauth_submitted'));
  await w.api.resumeActiveJob('fixture');
  assert.ok(w.data.activeSyncJob,'PARENT_TAB_IS_NOT_OAUTH_COMPLETION');
  assert.notEqual(w.local.lastSyncState?.stage,'done');
  await w.api.handleChatGptResult({ok:true,stage:'created',jobId:'fixture-job'},parentSender());
  assert.ok(w.data.activeSyncJob,'CREATED_IS_NOT_CONNECTED');
});

test('password release and privileged messages require the actual browser sender, matching request and owned popup',async()=>{
  const w=worker(makeJob());
  assert.equal((await w.api.handleOauthReady(authorization.href,sender('https://attacker.invalid/oauth/authorize'))).ok,false,'FORGED_MESSAGE_URL_MUST_NOT_RELEASE_PASSWORD');
  assert.equal((await w.api.handleOauthReady(authorization.href,{...sender(),frameId:2})).ok,false);
  w.tabs.get(2).openerTabId=99;
  assert.equal((await w.api.handleOauthReady(authorization.href,sender())).ok,false);
  w.tabs.get(2).openerTabId=1;
  const wrong=new URL(authorization);wrong.searchParams.set('client_id','other-client');w.tabs.get(2).url=wrong.href;
  assert.equal((await w.api.handleOauthReady(wrong.href,sender(wrong.href))).ok,false);
  w.tabs.get(2).url=authorization.href;
  assert.equal((await w.api.handleOauthReady(authorization.href,sender())).password,'synthetic-password-not-real');
  assert.equal(w.data.activeSyncJob.oauthTabId,2);
  assert.equal((await w.send({type:'READ_LOCAL'},sender())).ok,false,'CONTENT_SCRIPT_MUST_NOT_READ_LOCAL_CREDENTIALS');
});

test('callback tracking is bound to the OAuth tab and state; only exact app connection evidence completes',async()=>{
  const w=worker(makeJob());
  await w.api.handleOauthReady(authorization.href,sender());
  await w.api.handleOauthSubmitted(authorization.href,sender());
  assert.equal(typeof w.api.observeOAuthNavigation,'function');
  await w.api.observeOAuthNavigation(1,callback+'?code=synthetic&state=fixture-state');
  assert.notEqual(w.data.activeSyncJob?.phase,'oauth_returned');
  await w.api.observeOAuthNavigation(2,callback+'?code=synthetic&state=wrong');
  assert.notEqual(w.data.activeSyncJob?.phase,'oauth_returned');
  await w.api.observeOAuthNavigation(2,callback+'?code=synthetic&state=fixture-state');
  assert.equal(w.data.activeSyncJob?.phase,'oauth_returned');
  assert.ok(!JSON.stringify(w.data).includes('code=synthetic'));
  await w.api.handleChatGptResult({ok:true,stage:'connected',connectionObserved:true,jobId:'other-job'},parentSender());
  assert.ok(w.data.activeSyncJob);
  await w.api.handleChatGptResult({ok:true,stage:'connected',connectionObserved:true,jobId:'fixture-job'},parentSender());
  assert.equal(w.data.activeSyncJob,undefined);
  assert.equal(w.local.lastSyncState?.stage,'done');
});
