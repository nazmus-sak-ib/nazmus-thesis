import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedKeys,moveRow,resultRowKeys} from '../src/rowOrder.js';
test('row moves preserve aligned identities and survive refresh with added or removed results',()=>{
 const keys=['a','b','c'];
 assert.deepEqual(moveRow(keys,'a','c',true),['b','c','a']);
 assert.deepEqual(moveRow(keys,'c','a'),['c','a','b']);
 assert.deepEqual(orderedKeys(['a','c','d'],['b','c','a']),['c','a','d']);
 assert.deepEqual(orderedKeys(keys,JSON.parse(JSON.stringify(['c','a','b']))),['c','a','b']);
});
test('result identity ignores estimates but separates groups and duplicate rows',()=>{
 const row={lhs:'y',op:'~',rhs:'x',est:1};
 assert.deepEqual(resultRowKeys([row]),resultRowKeys([{...row,est:2}]));
 assert.equal(new Set(resultRowKeys([row,row,{...row,group:2}])).size,3);
});
