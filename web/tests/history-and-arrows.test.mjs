import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historySnapshot, createHistory, observeHistory, commitHistory, stepHistory } from '../src/pageHistory.js';
import { closestArrowEnd, arrowSnapPoints, snapArrowEndpoint, reattachArrow } from '../src/arrowReconnect.js';

const snapshot = value => JSON.stringify({ value });
test('a complete drag is one undo step; redo restores the final position', () => {
  const h=createHistory(snapshot(0));
  for(let i=1;i<=100;i++)observeHistory(h,snapshot(i));
  commitHistory(h);
  assert.equal(h.past.length,1);
  assert.equal(stepHistory(h,'undo').value,0);
  assert.equal(stepHistory(h,'redo').value,100);
});
test('undo includes edits still pending in a typing group',()=>{
  const h=createHistory(snapshot(''));observeHistory(h,snapshot('hello'));
  assert.equal(stepHistory(h,'undo').value,'');assert.equal(stepHistory(h,'redo').value,'hello');
});
test('new edits after undo discard redo; a no-op does not',()=>{
  const h=createHistory(snapshot(0));observeHistory(h,snapshot(1));commitHistory(h);stepHistory(h,'undo');
  observeHistory(h,snapshot(0));assert.equal(h.future.length,1);
  observeHistory(h,snapshot(2));commitHistory(h);assert.equal(h.future.length,0);
});
test('page histories remain independent and bounded',()=>{
  const pages=new Map([['a',createHistory(snapshot(0))],['b',createHistory(snapshot(10))]]);
  for(let i=1;i<=80;i++){observeHistory(pages.get('a'),snapshot(i));commitHistory(pages.get('a'));}
  assert.equal(pages.get('a').past.length,60);assert.equal(pages.get('b').present,snapshot(10));
});
test('viewport and comparison UI do not enter document history',()=>{
  assert.equal(historySnapshot({notes:[],viewport:{zoom:1},comparison_ids:['A']}),historySnapshot({notes:[],viewport:{zoom:2},comparison_ids:[]}));
});
test('stack membership, arrows and notes restore together',()=>{
  const original={stacks:[{id:'s',members:['A','B']}],edges:[{id:'e',source:'s',target:'C',data:{noteHtml:'arrow'}}],model_notes:{A:'model'},decorations:[{data:{members:['s']}}]};
  const h=createHistory(historySnapshot(original));observeHistory(h,historySnapshot({stacks:[],edges:[],model_notes:{},decorations:[]}));
  assert.deepEqual(stepHistory(h,'undo'),original);
});
test('endpoint choice follows the closer original end',()=>{
  assert.equal(closestArrowEnd({x:10,y:5},{x:0,y:0},{x:100,y:0}),'source');
  assert.equal(closestArrowEnd({x:90,y:5},{x:0,y:0},{x:100,y:0}),'target');
});
const node={position:{x:100,y:200},width:300,height:200};
test('four snap points follow the node dimensions and position',()=>{
  assert.deepEqual(arrowSnapPoints(node).map(p=>[p.side,p.x,p.y]),[['left',100,300],['right',400,300],['top',250,200],['bottom',250,400]]);
  assert.deepEqual(arrowSnapPoints(null),[]);
});
test('snap is restricted to the original item; distant release cancels',()=>{
  const points=arrowSnapPoints(node);
  assert.equal(snapArrowEndpoint({x:250,y:210},points).side,'top');
  assert.equal(snapArrowEndpoint({x:999,y:999},points),null);
});
test('reattachment preserves identity, endpoints, note, style and bend',()=>{
  const edge={id:'e',source:'A',target:'B',sourceHandle:'source-right',targetHandle:'target-left',data:{noteHtml:'<b>Keep</b>',appearance:{color:'red'},bend:{x:10,y:20}}};
  const result=reattachArrow(edge,'target',{handle:'source-bottom'});
  assert.deepEqual(result,{...edge,targetHandle:'source-bottom'});assert.equal(reattachArrow(edge,'source',null),edge);
});
