import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPublishedWorkspace } from '../src/loadPublishedWorkspace.js';
test('fresh visitors load the saved workspace at the repository subpath',async()=>{
  const calls=[],workspace={kind:'sem-workspace',pages:[{title:'CFA'},{title:'SEM'}]};
  const value=await loadPublishedWorkspace('/nazmus-thesis/',async url=>{calls.push(url);return {ok:true,status:200,json:async()=>workspace};});
  assert.deepEqual(value,workspace);assert.deepEqual(calls,['/nazmus-thesis/workspace.json']);
});
test('legacy layout fallback only follows a missing workspace',async()=>{
  const calls=[];
  assert.deepEqual(await loadPublishedWorkspace('/',async url=>{calls.push(url);return url.endsWith('workspace.json')?{status:404}:{ok:true,status:200,json:async()=>({schema_version:'9.0'})};}),{schema_version:'9.0'});
  assert.deepEqual(calls,['/workspace.json','/layout.json']);
  await assert.rejects(loadPublishedWorkspace('/',async()=>({ok:false,status:503})),/workspace.json/);
  await assert.rejects(loadPublishedWorkspace('/',async()=>({ok:true,status:200,json:async()=>{throw Error('Invalid JSON');}})),/Invalid JSON/);
});
test('SPA HTML fallback is not mistaken for a saved workspace',async()=>{
  const value=await loadPublishedWorkspace('/',async url=>url.endsWith('workspace.json')
    ?{ok:true,status:200,headers:{get:()=> 'text/html'}}
    :{ok:true,status:200,json:async()=>({schema_version:'9.0'})});
  assert.equal(value.schema_version,'9.0');
});
