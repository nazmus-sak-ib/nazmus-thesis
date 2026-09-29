export const CFA_VIEWS = [['reliability','Reliability & AVE'],['latent','Latent correlations'],['validity','Discriminant validity'],['residuals','Residuals'],['standardized','Standardized solution']];
export function variantsOf(raw) {
  if(raw?.kind!=='cfa_bundle')return [];
  if(!Array.isArray(raw.variants)||!raw.variants.length)throw Error('CFA bundle contains no variants.');
  const ids=new Set();
  for(const v of raw.variants){if(typeof v?.id!=='string'||!v.id||ids.has(v.id))throw Error('Invalid or duplicate CFA variant ID.');ids.add(v.id);}
  return raw.variants;
}
export function selectResult(raw, id) {
  const variants=variantsOf(raw);
  if(!variants.length)return raw;
  const selected=variants.find(v=>v.id===(id??raw.default_variant))??(!id?variants[0]:null);
  if(!selected)throw Error('The saved CFA variant is no longer present: '+id);
  return {...selected, isCfaVariant:true};
}
export function comparisonKey(modelId,variantId){return variantId?'cfa:'+JSON.stringify([modelId,variantId]):modelId;}
export function comparisonIdentity(key){try{if(key.startsWith('cfa:')){const a=JSON.parse(key.slice(4));if(Array.isArray(a)&&a.length===2)return {modelId:a[0],variantId:a[1]};}}catch{/* legacy model ID */}return {modelId:key};}
export function namedValues(value, prefix='') {
  if(!value||typeof value!=='object')return [];
  if(value.kind==='named_values')return (value.entries??[]).map(e=>({name:prefix+e.name,value:e.value}));
  if(value.kind==='table')return (value.rows??[]).flatMap((r,i)=>Object.entries(r).filter(([k,v])=>!['group','level','block'].includes(k)&&typeof v==='number').map(([k,v])=>({name:[prefix,r.group??r.level??value.row_names?.[i],k].filter(Boolean).join(' / '),value:v})));
  return Object.entries(value).flatMap(([k,v])=>typeof v==='number'||v===null?[{name:prefix+k,value:v}]:namedValues(v,prefix+k+' / '));
}
export function normalizeCfaData(data){
  if(!data?.isCfaVariant)return data;
  const patterns=(value,group='1')=>value?.kind==='matrix'?[{group,n_patterns:value.values?.length??0}]:value&&typeof value==='object'?Object.entries(value).flatMap(([k,v])=>patterns(v,k)):[];
  return {...data,r_squared:Array.isArray(data.r_squared)?data.r_squared:namedValues(data.r_squared).map(e=>({variable:e.name,r2:e.value})),missing_patterns:Array.isArray(data.missing_patterns)?data.missing_patterns:patterns(data.missing_patterns)};
}
export function reliabilityRows(data){
  const omega=new Map(namedValues(data?.supplementary?.omega?.data).map(e=>[e.name,e.value]));
  const ave=new Map(namedValues(data?.supplementary?.ave?.data).map(e=>[e.name,e.value]));
  return [...new Set([...omega.keys(),...ave.keys()])].map(factor=>({factor,indicators:new Set((data.parameters??[]).filter(p=>p.op==='=~'&&p.lhs===factor).map(p=>p.rhs)).size||undefined,omega:omega.get(factor),AVE:ave.get(factor)}));
}
// _cfa_json_value(data.frame) emits a tagged table; accept ordinary row arrays
// too, so older/manual exporters can supply the same assessment.
export function ronkkoRows(data){
  const value=data?.ronkko;
  const rows=Array.isArray(value)?value:value?.kind==='table'?value.rows:[];
  return Array.isArray(rows)?rows.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)):[];
}
export function cfaViewAvailable(data,key){
  if(!CFA_VIEWS.some(([id])=>id===key))return true;
  if(key==='reliability')return reliabilityRows(data).length>0;
  if(key==='validity')return ronkkoRows(data).length>0||['htmt','fornell_larcker'].some(k=>data?.supplementary?.[k]?.data!=null);
  return key==='latent'?!!data?.latent_correlations:key==='residuals'?!!data?.residuals:Array.isArray(data?.standardized_solution)&&data.standardized_solution.length>0;
}
