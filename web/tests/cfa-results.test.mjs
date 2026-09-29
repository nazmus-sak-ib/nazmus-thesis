import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectResult,variantsOf,comparisonKey,comparisonIdentity,normalizeCfaData,reliabilityRows,cfaViewAvailable} from '../src/cfaResults.js';
const bundle=JSON.parse(readFileSync(new URL('../results/U1a.json',import.meta.url)));
test('actual exported variants preserve reliability and R squared',()=>{
  assert.equal(variantsOf(bundle).length,4);
  for(const v of bundle.variants){const data=normalizeCfaData(selectResult(bundle,v.id));assert.ok(reliabilityRows(data).length);assert.ok(data.r_squared.length);assert.deepEqual(normalizeCfaData(data),data);assert.ok(cfaViewAvailable(data,'standardized'));}
});
test('comparison identity is stable and variants remain distinct',()=>{
  assert.notEqual(comparisonKey('U1a','U1a'),comparisonKey('U1a','U1a_ml'));
  assert.deepEqual(comparisonIdentity(comparisonKey('U1a','U1a_ml')),{modelId:'U1a',variantId:'U1a_ml'});
  assert.deepEqual(comparisonIdentity('B1'),{modelId:'B1'});
  assert.throws(()=>selectResult(bundle,'missing'));
});
test('legacy data and absent diagnostics remain supported',()=>{
  const legacy={parameters:[],r_squared:[]};assert.equal(selectResult(legacy),legacy);
  assert.equal(cfaViewAvailable(legacy,'reliability'),false);
  assert.equal(cfaViewAvailable(legacy,'overview'),true);
  assert.equal(bundle.variants.find(v=>v.id==='U1a_wt').supplementary.htmt.status,'not_supplied');
});
