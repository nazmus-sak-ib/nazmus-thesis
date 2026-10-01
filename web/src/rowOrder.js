export function orderedKeys(keys, saved = []) {
  const known = new Set(keys);
  const retained = Array.isArray(saved) ? [...new Set(saved)].filter(key => known.has(key)) : [];
  const seen = new Set(retained);
  return [...retained, ...keys.filter(key => !seen.has(key))];
}
export function moveRow(keys, source, target, after = false) {
  if(source===target || !keys.includes(source) || !keys.includes(target))return keys;
  const next=keys.filter(key=>key!==source);
  next.splice(next.indexOf(target)+(after?1:0),0,source);
  return next;
}
export function resultRowKeys(rows) {
  const counts=new Map();
  return rows.map(row=>{
    const identity=JSON.stringify(['group','level','block','lhs','op','rhs','variable','measure','name'].map(field=>row[field]??null));
    const occurrence=counts.get(identity)??0;counts.set(identity,occurrence+1);
    return identity+':'+occurrence;
  });
}
