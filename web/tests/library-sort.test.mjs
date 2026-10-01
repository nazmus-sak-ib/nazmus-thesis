import test from 'node:test';
import assert from 'node:assert/strict';
import {sortModels} from '../src/librarySort.js';
import {contentMinZoom,clearStackEndpoints} from '../src/canvasGeometry.js';
import {pageHasContent, removePageContent, pageContentItems} from '../src/workspaceState.js';

const model=(id,json,svg)=>({id,type:'model',data:{title:id,jsonModified:json,svgModified:svg}});
test('large canvases can zoom below the previous floor but retain a finite limit',()=>{
  const boxes=[{x:-5000,y:0,width:300,height:300},{x:5000,y:0,width:300,height:300}];
  const zoom=contentMinZoom(boxes,{width:1000,height:700});
  assert.ok(zoom<0.1 && zoom>0);
  assert.ok(10300*zoom<1000);
  assert.equal(contentMinZoom([],{width:1000,height:700}),0.5);
});
test('both stack endpoints clear rear cards without changing attachment identity',()=>{
  const edge={source:'a',target:'b',sourcePosition:'top',targetPosition:'left',sourceX:100,sourceY:100,targetX:300,targetY:300};
  const result=clearStackEndpoints(edge,()=>true);
  assert.equal(result.sourceY,80);assert.equal(result.targetX,280);
  assert.equal(result.source,'a');assert.equal(result.target,'b');
  assert.deepEqual(clearStackEndpoints(edge,()=>false),edge);
});
test('sort independently by name, JSON, or SVG, with unknown dates last',()=>{
  const items=[model('M10','2020-01-01','2024-01-01'),model('M2','2024-01-01','2020-01-01'),model('M3')];
  assert.deepEqual(sortModels(items,'name-asc').map(n=>n.id),['M2','M3','M10']);
  assert.deepEqual(sortModels(items,'json-desc').map(n=>n.id),['M2','M10','M3']);
  assert.deepEqual(sortModels(items,'svg-desc').map(n=>n.id),['M10','M2','M3']);
  assert.deepEqual(sortModels(items,'json-asc').map(n=>n.id),['M10','M2','M3']);
  assert.equal(items[0].id,'M10');
});
test('stack date uses its most recently modified member',()=>{
  const a=model('a','2020-01-01'), b=model('b','2025-01-01'), c=model('c','2023-01-01');
  const stack={id:'stack',type:'stack',data:{title:'Stack',memberIds:['a','b']}};
  assert.equal(sortModels([c,stack],'json-desc',[a,b,c,stack])[0].id,'stack');
});
test('canvas text prevents deleting a nonempty page and can be found and removed',()=>{
  const page={layout:{schema_version:'9.0',used_models:[],decorations:[{id:'text-1',type:'text',data:{text:'Hello'}}]}};
  assert.equal(pageHasContent(page),true);
  const item=pageContentItems(page)[0];
  assert.equal(item.kind,'text');
  assert.equal(pageHasContent({layout:removePageContent(page.layout,item)}),false);
});
