import test from 'node:test';
import assert from 'node:assert/strict';
import {cellHighlight,latentCorrelation,statisticsSettings} from '../src/statisticsStyle.js';
const matrix=r=>({kind:'matrix',row_names:['Y','X'],column_names:['Y','X'],values:[[1,r],[r,1]]});
const data={metadata:{latent_variables:['Y','X']},parameters:[],latent_correlations:matrix(.7)};
const row={lhs:'Y',op:'~',rhs:'X',est:-.3,'std.lv':-.2,'std.all':-.4,pvalue:.17,'ci.lower':-.5,'ci.upper':.1};
test('sign reversals are independent of significance, and only coefficient cells are colored',()=>{
  for(const field of ['est','std.lv','std.all'])assert.equal(cellHighlight(row,field,data).className,'stat-sign-reversal stat-p-high');
  assert.equal(cellHighlight(row,'pvalue',data).className,'stat-p-high');
  for(const field of ['ci.lower','ci.upper','z','se'])assert.deepEqual(cellHighlight(row,field,data),{});
  assert.equal(cellHighlight(row,'est',data,{signs:false}).className,'stat-p-high');
  assert.equal(cellHighlight(row,'est',data,{pvalues:false}).className,'stat-sign-reversal');
  assert.equal(cellHighlight({...row,pvalue:.001},'est',data).className,'stat-sign-reversal');
});
test('p-values above alpha only, including fit rows and optional missing values',()=>{
  assert.deepEqual(cellHighlight({pvalue:.05},'pvalue',data),{});
  assert.equal(cellHighlight({pvalue:.03},'pvalue',data,{alpha:.01}).className,'stat-p-high');
  for(const pvalue of [null,undefined,NaN,-1,2])assert.deepEqual(cellHighlight({pvalue},'pvalue',data),{});
  assert.deepEqual(cellHighlight(row,'pvalue',data,{pvalues:false}),{});
  assert.equal(cellHighlight({measure:'pvalue.scaled',value:.2},'value',data).className,'stat-p-high');
});
test('missing, zero or inadmissible correlations do not imply a sign reversal',()=>{
  for(const r of [0,null,1.1,-1.1])assert.deepEqual(cellHighlight({...row,pvalue:.001},'est',{...data,latent_correlations:matrix(r)}),{});
  assert.deepEqual(cellHighlight({...row,pvalue:.001},'est',{}),{});
  assert.deepEqual(cellHighlight({...row,pvalue:.001,rhs:'unmatched'},'est',data),{});
});
test('group labels select the matching correlation matrix',()=>{
  const grouped={...data,metadata:{group_labels:['first','second']},latent_correlations:{first:matrix(.6),second:matrix(-.6)}};
  assert.equal(latentCorrelation(grouped,{...row,group:1}),.6);
  assert.equal(latentCorrelation(grouped,{...row,group:2}),-.6);
  assert.deepEqual(cellHighlight({...row,pvalue:.001,group:2},'est',grouped),{});
});
test('negative latent variances distinguish observed variances and covariances',()=>{
  const variance={lhs:'Y',rhs:'Y',op:'~~',est:-.1};
  assert.equal(cellHighlight(variance,'est',data).className,'stat-negative-variance');
  assert.deepEqual(cellHighlight({...variance,lhs:'observed',rhs:'observed'},'est',data),{});
  assert.deepEqual(cellHighlight({...variance,rhs:'X'},'est',data),{});
  assert.deepEqual(cellHighlight(variance,'est',data,{negativeVariances:false}),{});
  assert.equal(statisticsSettings().alpha,.05);
});
