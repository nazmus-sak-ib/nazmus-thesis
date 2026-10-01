import test from 'node:test';
import assert from 'node:assert/strict';
import {applySticker,stickerKey,stickerEntries,reorderStickerList,enforceStickerFamilies,validateStickerLibrary} from '../src/stickers.js';
import {pageHasContent,removePageContent,normalizeWorkspace} from '../src/workspaceState.js';
import {workspaceFingerprint} from '../src/workspaceUi.js';
const families=[{id:'dataset',name:'Dataset',multiple:false,stickers:[{id:'d1',name:'First',code:'D1'},{id:'d2',name:'Second',code:'D2'}]},
  {id:'warning',name:'Warnings',multiple:true,stickers:[{id:'w1',name:'First warning',code:'W1'},{id:'w2',name:'Second warning',code:'W2'}]}];
test('unique families replace siblings while multiple warnings accumulate',()=>{
  const key=stickerKey('M','MLR');let state={};
  for(const id of ['d1','w1','w2','d2','w2'])state=applySticker(state,[key],id,families);
  assert.deepEqual(state[key],['w1','d2','w2']);
});
test('variant and page assignments stay independent, and bulk removal preserves unrelated badges',()=>{
  const keys=[stickerKey('M','ordinal'),stickerKey('M','MLR'),stickerKey('B')];
  const original={};const assigned=applySticker(original,keys,'d1',families);
  assert.deepEqual(original,{});
  const removed=applySticker(assigned,[keys[0]],'d1',families,true);
  assert.equal(removed[keys[0]],undefined);assert.deepEqual(removed[keys[1]],['d1']);
  assert.deepEqual(applySticker(assigned,keys,'d1',families,true),{});
});
test('changing a family to unique retains the most recently assigned sticker',()=>{
  const key=stickerKey('M');assert.deepEqual(enforceStickerFamilies({[key]:['d1','w1','d2','w2']},families)[key],['w1','d2','w2']);
});
test('reordering definitions changes display order without changing sticker identity',()=>{
  const ordered=reorderStickerList(families,'warning','dataset');
  assert.deepEqual(stickerEntries(ordered).map(s=>s.id),['w1','w2','d1','d2']);
  assert.equal(families[0].id,'dataset');
});
test('sticker assignments protect pages and explicit model removal clears all its variants',()=>{
  const layout={schema_version:'9.0',used_models:[],sticker_assignments:{[stickerKey('M','a')]:['d1'],[stickerKey('M','b')]:['w1']}};
  assert.equal(pageHasContent({layout}),true);
  assert.deepEqual(removePageContent(layout,{kind:'model',id:'M'}).sticker_assignments,{});
  assert.equal(pageHasContent({layout:removePageContent(layout,{kind:'stickers',id:'M'})}),false);
});
test('workspace round-trip keeps families, notes, ordering and page-specific assignments',()=>{
  const workspace={kind:'sem-workspace',schema_version:'10.0',active_page:'one',sticker_families:families,pages:[{id:'one',title:'One',type:'model',layout:{sticker_assignments:{[stickerKey('M')]:['d1']}}},{id:'two',title:'Two',type:'model',layout:{}}]};
  const loaded=normalizeWorkspace(JSON.parse(JSON.stringify(workspace)));
  assert.deepEqual(loaded,workspace);assert.equal(loaded.pages[1].layout.sticker_assignments,undefined);
  assert.notEqual(workspaceFingerprint(workspace),workspaceFingerprint({...workspace,sticker_families:[]}));
  assert.throws(()=>validateStickerLibrary([{...families[0],stickers:[families[0].stickers[0],families[0].stickers[0]]}]),/Invalid sticker/);
});
