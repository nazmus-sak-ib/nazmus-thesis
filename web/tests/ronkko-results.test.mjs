import test from 'node:test';
import assert from 'node:assert/strict';
import {ronkkoRows,cfaViewAvailable,selectResult} from '../src/cfaResults.js';
const rows=[{lhs:'Compatibility',rhs:'RangeConc',est:-.848,se:.012,'ci.lower':-.871,'ci.upper':-.825,UL:.871,class_CI:'Marginal',class_chi2:'Marginal',chi_cutoff:.9,chi_p:0}];
test('tagged R table and ordinary rows enable validity without HTMT or FL',()=>{
  for(const ronkko of [{kind:'table',rows,row_names:['209']},rows]){
    assert.deepEqual(ronkkoRows({ronkko}),rows);
    assert.equal(cfaViewAvailable({ronkko},'validity'),true);
  }
});
test('Rönkkö data belongs to the selected variant and missing results stay hidden',()=>{
  const bundle={kind:'cfa_bundle',variants:[{id:'first',ronkko:{kind:'table',rows}},{id:'second',ronkko:null}]};
  assert.deepEqual(ronkkoRows(selectResult(bundle,'first')),rows);
  assert.equal(cfaViewAvailable(selectResult(bundle,'second'),'validity'),false);
  for(const ronkko of [null,{},[],{kind:'table',rows:null}])assert.deepEqual(ronkkoRows({ronkko}),[]);
});
