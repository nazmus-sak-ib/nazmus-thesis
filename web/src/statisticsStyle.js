export const DEFAULT_STATISTICS = { pvalues:true, alpha:0.05, signs:true, negativeVariances:true };
export function statisticsSettings(value={}) {
  return {...DEFAULT_STATISTICS,...value,alpha:typeof value.alpha==='number'&&value.alpha>0&&value.alpha<1?value.alpha:0.05};
}
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function latentCorrelation(data,row) {
  const matrices=[];
  function walk(value,path=[]) {
    if(value?.kind==='matrix'){matrices.push({value,path});return;}
    if(value&&typeof value==='object')Object.entries(value).forEach(([key,child])=>walk(child,[...path,key]));
  }
  walk(data?.latent_correlations);
  let candidates=matrices;
  if(matrices.length>1) {
    const labels=data?.metadata?.group_labels??[];
    const groupLabel=labels[Number(row.group??1)-1];
    const group=String(groupLabel??row.group??'1');
    candidates=candidates.filter(m=>m.path.includes(group));
    if(row.level!=null)candidates=candidates.filter(m=>m.path.includes(String(row.level)));
  }
  if(candidates.length!==1)return null;
  const matrix=candidates[0].value;
  const i=matrix.row_names?.indexOf(row.lhs),j=matrix.column_names?.indexOf(row.rhs);
  if(i<0||j<0||i==null||j==null)return null;
  const value=matrix.values?.[i]?.[j];
  return finite(value)&&Math.abs(value)<=1?value:null;
}
export function cellHighlight(row,field,data,options) {
  const highlight=baseHighlight(row,field,data,options);
  const settings=statisticsSettings(options);
  const p=row?.pvalue??row?.['p.value'];
  if(settings.pvalues&&['est','std.lv','std.all'].includes(field)&&finite(row?.[field])&&finite(p)&&p>settings.alpha&&p<=1){
    return {...highlight,className:[highlight.className,'stat-p-high'].filter(Boolean).join(' '),title:[highlight.title,`p > ${settings.alpha}`].filter(Boolean).join('; ')};
  }
  return highlight;
}
function baseHighlight(row,field,data,options) {
  const settings=statisticsSettings(options),value=row?.[field];
  if(!row)return {};
  const pColumn=['pvalue','p.value','p','chi_p'].includes(field)||(field==='value'&&/^pvalue(?:\.|$)/.test(row.measure??''));
  if(settings.pvalues&&pColumn&&finite(value)&&value>=0&&value<=1&&value>settings.alpha)
    return {className:'stat-p-high',title:`p > ${settings.alpha}`};
  const latent=new Set([...(Array.isArray(data?.metadata?.latent_variables)?data.metadata.latent_variables:[]),...(Array.isArray(data?.parameters)?data.parameters:[]).filter(p=>p?.op==='=~').map(p=>p.lhs)]);
  if(settings.negativeVariances&&field==='est'&&row.op==='~~'&&row.lhs===row.rhs&&latent.has(row.lhs)&&finite(value)&&value<0)
    return {className:'stat-negative-variance',title:'Negative latent variance estimate (residual variance for an endogenous latent variable)'};
  if(settings.signs&&row.op==='~'&&['est','std.lv','std.all'].includes(field)&&finite(value)&&value!==0) {
    const correlation=latentCorrelation(data,row);
    if(correlation!==null&&correlation!==0&&Math.sign(value)!==Math.sign(correlation))return {className:'stat-sign-reversal',title:`Opposite sign to model-implied latent correlation (${correlation.toPrecision(4)})`};
  }
  return {};
}
