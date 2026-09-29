import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reorderPages, workspaceFingerprint } from '../src/workspaceUi.js';
const workspace={kind:'sem-workspace',active_page:'b',pages:[{id:'a',title:'A',layout:{notes:[]}},{id:'b',title:'B',layout:{notes:[]}},{id:'c',title:'C',layout:{notes:[]}}]};
test('page reorder keeps active identity and content',()=>{
 const next=reorderPages(workspace,'c','a');assert.deepEqual(next.pages.map(p=>p.id),['c','a','b']);assert.equal(next.active_page,'b');assert.equal(next.pages[0],workspace.pages[2]);assert.deepEqual(workspace.pages.map(p=>p.id),['a','b','c']);
});
test('drop after last page and no-op targets',()=>{
 assert.deepEqual(reorderPages(workspace,'a','c',true).pages.map(p=>p.id),['b','c','a']);assert.equal(reorderPages(workspace,'a','a'),workspace);assert.equal(reorderPages(workspace,'missing','a'),workspace);
});
test('navigation alone does not mark a workspace dirty',()=>assert.equal(workspaceFingerprint(workspace),workspaceFingerprint({...workspace,active_page:'a'})));
test('page order and actual layout changes mark dirty',()=>{
 assert.notEqual(workspaceFingerprint(workspace),workspaceFingerprint(reorderPages(workspace,'a','c',true)));
 assert.notEqual(workspaceFingerprint(workspace),workspaceFingerprint({...workspace,pages:workspace.pages.map(p=>({...p,layout:{notes:[{id:'new'}]}}))}));
});
test('save baseline remains the snapshot written, not edits made during saving',()=>{
 const saved=workspaceFingerprint(workspace),edited=reorderPages(workspace,'a','c',true);assert.notEqual(saved,workspaceFingerprint(edited));assert.equal(saved,workspaceFingerprint(JSON.parse(JSON.stringify(workspace))));
});
test('object property ordering is ignored by the dirty marker',()=>assert.equal(workspaceFingerprint({kind:'sem-workspace',pages:[]}),workspaceFingerprint({pages:[],kind:'sem-workspace'})));
test('visiting a page and loading default catalog sizes are not document edits',()=>{
 const hydrated={...workspace,pages:workspace.pages.map(p=>({...p,layout:{...p.layout,comparison_ids:[],viewport:{x:0,y:0,zoom:1},model_sizes:{unused:{width:320,height:260}}}}))};
 assert.equal(workspaceFingerprint(workspace),workspaceFingerprint(hydrated));
});
