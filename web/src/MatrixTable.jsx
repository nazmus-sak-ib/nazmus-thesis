import {useContext} from 'react';
import {MatrixSettingsContext} from './matrixContext.js';
import {matrixDefaults,isTriangularMatrix,matrixCell,validRanges,cellColor,contrastText} from './matrixSettings.js';
const display=v=>v==null?'Unavailable':typeof v==='number'?Number(v.toPrecision(5)).toString():String(v);
export default function MatrixTable({value,scope,path}) {
  const {settings,update}=useContext(MatrixSettingsContext);
  const key=JSON.stringify([scope,...path]);
  const config={...matrixDefaults(value,path),...settings[key]};
  const change=patch=>update(key,{...config,colorsEnabled:true,...patch});
  const triangular=isTriangularMatrix(value);
  const logical=value.values?.some(row=>row.some(v=>typeof v==='boolean'||v==='TRUE'||v==='FALSE'));
  const ranges=config.ranges??[];
  const valid=validRanges(ranges);
  const overlaps=valid.some((a,i)=>valid.slice(i+1).some(b=>Number(a.min)<Number(b.max)&&Number(b.min)<Number(a.max)));
  function editRange(index,patch){change({ranges:ranges.map((r,i)=>i===index?{...r,...patch}:r)});}
  return <section className="matrix-panel" aria-label="Matrix">
    <div className="cfa-matrix-scroll"><table className="cfa-matrix"><thead><tr><th></th>{(value.column_names??[]).map((x,i)=><th key={i}>{x}</th>)}</tr></thead><tbody>{(value.values??[]).map((row,i)=><tr key={i}><th>{value.row_names?.[i]}</th>{row.map((_,j)=>{
      const cell=matrixCell(value,i,j,config.triangle);
      const color=cell.hidden?null:cellColor(cell.value,i,j,config,triangular);
      return <td key={j} style={color?{backgroundColor:color,color:contrastText(color)}:undefined}>{cell.hidden?'':cell.value===true||cell.value==='TRUE'?'Pass':cell.value===false||cell.value==='FALSE'?'Fail':display(cell.value)}</td>;
    })}</tr>)}</tbody></table></div>
    <div className="matrix-legend" aria-label="Color legend">
      {config.colorsEnabled===false?<span>Colors cleared.</span>:logical?<>{[[config.passColor,'Pass'],[config.failColor,'Fail']].map(([color,label])=><span key={label}><i style={{background:color}}/>{label}</span>)}</>:valid.map((r,i)=><span key={i}><i style={{background:r.color}}/>{display(Number(r.min))} ≤ |value| {r.includeMax?"≤":"<"} {display(Number(r.max))}</span>)}
      {config.colorsEnabled!==false&&!logical&&!valid.length&&<span>No numeric color ranges defined.</span>}
      {triangular&&<small>{config.triangle==='upper'?'Upper':'Lower'} triangle · Diagonal uncolored</small>}
      {overlaps&&<small>Overlapping ranges: first matching rule takes precedence.</small>}
    </div>
    <details className="matrix-controls"><summary>Matrix display & colors</summary>
      {triangular?<label>Triangle <select aria-label="Matrix triangle" value={config.triangle} onChange={e=>change({triangle:e.target.value,colorsEnabled:config.colorsEnabled})}><option value="lower">Lower</option><option value="upper">Upper</option></select></label>:<p>Rectangular table: all cells shown.</p>}
      {logical?<div className="matrix-rule">{[['passColor','Pass'],['failColor','Fail']].map(([field,label])=><label key={field}>{label} color <input type="color" aria-label={label+' color'} value={config[field]} onInput={e=>change({[field]:e.target.value})} onChange={e=>change({[field]:e.target.value})}/></label>)}</div>:<>
        {ranges.map((r,i)=><div className="matrix-rule" key={i}><label>From (inclusive)<input type="number" step="any" aria-label={'Range '+(i+1)+' minimum'} value={r.min} onChange={e=>editRange(i,{min:e.target.value})}/></label><label>To<input type="number" step="any" aria-label={'Range '+(i+1)+' maximum'} value={r.max} onChange={e=>editRange(i,{max:e.target.value})}/></label><label>Color<input type="color" aria-label={'Range '+(i+1)+' color'} value={r.color} onInput={e=>editRange(i,{color:e.target.value})} onChange={e=>editRange(i,{color:e.target.value})}/></label><label><input type="checkbox" aria-label={"Range "+(i+1)+" include upper bound"} checked={!!r.includeMax} onChange={e=>editRange(i,{includeMax:e.target.checked})}/>Include upper bound</label><button onClick={()=>change({ranges:ranges.filter((_,n)=>n!==i)})} aria-label={'Remove range '+(i+1)}>Remove</button></div>)}
        <button onClick={()=>change({ranges:[...ranges,{min:'',max:'',color:'#ffcccc'}]})}>+ Add range</button>
        {valid.length!==ranges.length&&<p role="status">Incomplete ranges or ranges whose minimum is not below their maximum are not applied.</p>}
        {overlaps&&<p role="status">Ranges overlap. The first matching range wins; edit the bounds to make ranges exclusive.</p>}
      </>}
      <button onClick={()=>change({...matrixDefaults(value,path),triangle:config.triangle})}>{path[0]==="residuals"?"Generate default ranges":"Show defaults"}</button>
      <button onClick={()=>change({ranges:[],colorsEnabled:false})}>Clear colors</button>
      {!logical&&<p>Colors use absolute values; displayed numbers keep their signs. Residual defaults cover the off-diagonal absolute minimum through maximum, including the maximum.</p>}
      <p>Settings are shared across this model’s estimation variants on this page. Collapse these controls to keep just the matrix and legend for screenshots.</p>
    </details>
  </section>;
}
