export const defaultMatrixSettings = { triangle:'lower', ranges:[], passColor:'#e8f4ed', failColor:'#fbe9e9' };
const palette=['#edf8e9','#bae4b3','#fee8a6','#fdbb84','#e88484'];
export function matrixDefaults(matrix,path=[]) {
  const triangular=isTriangularMatrix(matrix);
  const values=(matrix.values??[]).flatMap((row,i)=>row.filter((v,j)=>typeof v==='number'&&Number.isFinite(v)&&(!triangular||i!==j)).map(Math.abs));
  if(!values.length)return {...defaultMatrixSettings};
  if(path[0]!=='residuals')return {...defaultMatrixSettings,ranges:palette.map((color,i)=>({min:i/5,max:(i+1)/5,color}))};
  const min=Math.min(...values),max=Math.max(...values);
  // Constant tables have no spread to divide; one inclusive band is honest.
  if(min===max)return {...defaultMatrixSettings,ranges:[{min,max:min+Math.max(1e-12,min*1e-6),color:palette[0]}]};
  const bounds=Array.from({length:6},(_,i)=>i===5?max:min+(max-min)*i/5);
  return {...defaultMatrixSettings,ranges:palette.map((color,i)=>({min:bounds[i],max:bounds[i+1],color,includeMax:i===4}))};
}
export function isTriangularMatrix(matrix) {
  const rows=matrix.row_names??[], cols=matrix.column_names??[];
  return rows.length>0&&rows.length===cols.length&&rows.every((name,i)=>name===cols[i]);
}
export function matrixCell(matrix,i,j,triangle='lower') {
  const triangular=isTriangularMatrix(matrix);
  if(triangular&&((triangle==='lower'&&j>i)||(triangle==='upper'&&i>j)))return {hidden:true};
  let value=matrix.values?.[i]?.[j];
  // For lower-only exports (e.g. Fornell–Larcker), use the opposite populated
  // cell when the requested triangle was not exported. Never replace a value.
  if(triangular&&i!==j&&(value==null||value==='')) {
    const mirrored=matrix.values?.[j]?.[i];
    if(mirrored!=null&&mirrored!=='')value=mirrored;
  }
  return {hidden:false,value};
}
export function validRanges(ranges=[]) {
  return ranges.filter(r=>r.min!==''&&r.max!==''&&Number.isFinite(Number(r.min))&&Number.isFinite(Number(r.max))&&Number(r.min)<Number(r.max)&&/^#[0-9a-f]{6}$/i.test(r.color??''));
}
export function cellColor(value,i,j,settings,triangular=true) {
  if(settings.colorsEnabled===false)return null;
  if(triangular&&i===j)return null;
  if(value===true||value==='TRUE')return settings.passColor;
  if(value===false||value==='FALSE')return settings.failColor;
  if(typeof value!=='number'||!Number.isFinite(value))return null;
  const magnitude=Math.abs(value);
  return validRanges(settings.ranges).find(r=>magnitude>=Number(r.min)&&(magnitude<Number(r.max)||(r.includeMax&&magnitude===Number(r.max))))?.color??null;
}
export function contrastText(color) {
  if(!/^#[0-9a-f]{6}$/i.test(color??''))return '#111111';
  const channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
  const l=channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  return l>.179?'#111111':'#ffffff';
}
