import test from 'node:test';
import assert from 'node:assert/strict';
import {matrixCell,isTriangularMatrix,cellColor,contrastText,validRanges,defaultMatrixSettings,matrixDefaults} from '../src/matrixSettings.js';
const matrix={row_names:['A','B'],column_names:['A','B'],values:[['',''],['FALSE','']]};
test('triangle switching mirrors lower-only checks and preserves blank diagonal',()=>{
  assert.equal(matrixCell(matrix,1,0).value,'FALSE');
  assert.equal(matrixCell(matrix,0,1).hidden,true);
  assert.equal(matrixCell(matrix,0,1,'upper').value,'FALSE');
  assert.equal(matrixCell(matrix,1,0,'upper').hidden,true);
  assert.equal(matrixCell(matrix,0,0).value,'');
});
test('rectangular matrices and differently labeled axes remain complete',()=>{
  const rect={...matrix,column_names:['C','D']};assert.equal(isTriangularMatrix(rect),false);
  assert.equal(matrixCell(rect,0,1).hidden,false);
});
test('numeric bounds are lower-inclusive upper-exclusive and first match wins',()=>{
  const settings={...defaultMatrixSettings,ranges:[{min:'0.5',max:'0.6',color:'#ff0000'},{min:'0.6',max:'0.7',color:'#000000'}]};
  assert.equal(cellColor(.5,1,0,settings),'#ff0000');assert.equal(cellColor(.6,1,0,settings),'#000000');
  assert.equal(cellColor(-.5,1,0,settings),'#ff0000');
  assert.equal(cellColor(.7,1,0,settings),null);assert.equal(cellColor(.55,0,0,settings),null);
  assert.equal(cellColor(null,1,0,settings),null);
  assert.equal(cellColor('FALSE',1,0,settings),settings.failColor);
  assert.equal(contrastText('#000000'),'#ffffff');assert.equal(contrastText('#ffffff'),'#111111');
  assert.equal(validRanges([{min:'',max:1,color:'#ff0000'},{min:2,max:1,color:'#ff0000'}]).length,0);
});
test('correlation defaults exclude one; residual defaults include the maximum magnitude',()=>{
  const m={row_names:['A','B','C'],column_names:['A','B','C'],values:[[1,-.2,.7],[-.2,1,-.9],[.7,-.9,1]]};
  const correlations=matrixDefaults(m,['latent']);
  assert.equal(correlations.ranges.length,5);
  assert.equal(cellColor(1,1,0,correlations),null);
  assert.ok(cellColor(-.9999,1,0,correlations));
  const residuals=matrixDefaults(m,['residuals','cov']);
  assert.equal(residuals.ranges[0].min,.2);
  assert.equal(residuals.ranges[4].max,.9);
  assert.ok(cellColor(-.9,1,0,residuals));
  assert.equal(cellColor(-.9,1,0,{...residuals,colorsEnabled:false}),null);
  assert.deepEqual(matrixDefaults({values:[[null,'']]},['residuals']).ranges,[]);
  assert.equal(matrixDefaults({values:[[0,0]]},['residuals']).ranges.length,1);
});
