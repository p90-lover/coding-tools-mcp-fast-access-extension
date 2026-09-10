import test from 'node:test';
import assert from 'node:assert/strict';
import {el,loadContentScript} from '../../tests/dom-stub.mjs';
const app='coding-tools-mcp';
function card(name,status,pending=false){
  return el('article',{rect:{top:190,left:300,width:600,height:100}},[
    el('h3',{text:name}),el('a',{href:'/plugins/plugin_asdk_fixture',text:`Open ${name}`}),
    el('span',{role:'status',text:status}),el('button',{'aria-label':`Actions for ${name}`}),
    ...(pending?[el('button',{text:'Connect'})]:[]),
  ]);
}
test('connection observation is exact-app scoped and Connect overrides a stale Connected badge',()=>{
  for(const [own,other,pending,expected] of [['Not connected','Connected',false,false],['Connected','Not connected',true,false],['Connected','Not connected',false,true]]){
    const {internals}=loadContentScript({url:'https://chatgpt.com/plugins?view=personal',body:el('body',{},[el('main',{},[card(app,own,pending),card('other-app',other)])])});
    assert.equal(internals.observeAppConnection(app).connectionObserved,expected,`${own}/${other}/${pending}`);
  }
});
