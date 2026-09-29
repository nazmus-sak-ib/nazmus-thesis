import MatrixTable from './MatrixTable.jsx';
import { reliabilityRows, ronkkoRows } from './cfaResults.js';
const display=v=>v==null?'':typeof v==='number'?Number(v.toPrecision(5)).toString():String(v);
export function CfaPayload({value,scope="model",path=[]}){
  if(value==null)return <p className="empty-message">Unavailable for this variant.</p>;
  if(value.kind==='matrix')return <MatrixTable value={value} scope={scope} path={path}/>;
  if(value.kind==='named_values')return <dl>{value.entries.map((e,i)=><div key={i}><dt>{e.name}</dt><dd>{display(e.value)}</dd></div>)}</dl>;
  if(value.kind==='table')return <CfaPayload scope={scope} path={path} value={{kind:'matrix',column_names:Object.keys(value.rows?.[0]??{}),row_names:value.row_names??[],values:(value.rows??[]).map(r=>Object.values(r))}}/>;
  if(typeof value==='object')return <>{Object.entries(value).map(([k,v])=><details key={k} open={k==='cov'}><summary>{k}</summary><CfaPayload value={v} scope={scope} path={[...path,k]}/></details>)}</>;
  return <span>{display(value)}</span>;
}
function Supplement({entry,scope,path}){return <>{entry?.error&&<p className="error-message">{entry.error}</p>}{(Array.isArray(entry?.warnings)?entry.warnings:entry?.warnings?[entry.warnings]:[]).map((w,i)=><p key={i}>{w}</p>)}<CfaPayload value={entry?.data} scope={scope} path={path}/></>;}
export default function CfaView({data,view,Table}){
  const scope=data?.metadata?.model_id??"model";
  if(view==='reliability')return <><p>Omega and AVE for the selected fit. Blank cells indicate unavailable estimates.</p><Table rows={reliabilityRows(data)}/>{['omega','ave'].map(k=><details key={k}><summary>{k==='omega'?'Omega calculation settings':'AVE details'}</summary><CfaPayload value={data?.supplementary?.[k]?.settings}/>{data?.supplementary?.[k]?.error&&<p>{data.supplementary[k].error}</p>}</details>)}</>;
  if(view==='latent')return <CfaPayload value={data?.latent_correlations} scope={scope} path={["latent"]}/>;
  if(view==='standardized')return <><p>Fully standardized estimates (std.all), with standard errors and confidence intervals on that scale.</p><Table rows={data?.standardized_solution??[]}/></>;
  if(view==='residuals')return <><p>Observed minus model-implied associations. Expand a section to inspect its matrix or summary.</p><CfaPayload value={data?.residuals} scope={scope} path={["residuals"]}/></>;
  return <>{ronkkoRows(data).length>0&&<section aria-label="Rönkkö & Cho discriminant validity"><h3>Rönkkö & Cho discriminant validity</h3><p>Estimates, confidence intervals, and classifications as exported for this variant.</p><Table rows={ronkkoRows(data)} preferredColumns={['lhs','rhs','est','se','ci.lower','ci.upper','UL','class_CI','class_chi2','chi_cutoff','chi_p']}/></section>}<h3>{data?.supplementary?.htmt?.method??'HTMT'}</h3><Supplement entry={data?.supplementary?.htmt} scope={scope} path={["htmt"]}/><h3>Fornell–Larcker criterion checks</h3><p>Both factors’ AVEs must exceed their squared latent correlation. Blank triangle cells were not evaluated.</p><Supplement entry={data?.supplementary?.fornell_larcker} scope={scope} path={["fornell_larcker"]}/></>;
}
