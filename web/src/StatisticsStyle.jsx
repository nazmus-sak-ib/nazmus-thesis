import {StableTextField} from './CanvasText.jsx';
import {useContext} from 'react';
import {StatisticsContext,ResultDataContext} from './statisticsContext.js';
import {cellHighlight} from './statisticsStyle.js';
export function StatisticalCell({row,field,data,children,className='',...props}) {
  const {settings}=useContext(StatisticsContext),inherited=useContext(ResultDataContext);
  const highlight=cellHighlight(row,field,data??inherited,settings);
  return <td {...props} className={[className,highlight.className].filter(Boolean).join(' ')} title={highlight.title}>{children}{highlight.className?.includes('stat-negative-variance')&&<span className="variance-warning" aria-label="Negative latent variance"> ⚠</span>}</td>;
}
export function StatisticsControls() {
  const {settings,update}=useContext(StatisticsContext);
  return <details className="statistics-controls"><summary>Statistical colors · α = {settings.alpha}</summary><div>
    <label><input type="checkbox" checked={settings.signs} onChange={e=>update({signs:e.target.checked})}/> Sign reversals</label>
    <label><input type="checkbox" checked={settings.pvalues} onChange={e=>update({pvalues:e.target.checked})}/> p-values above α</label>
    <label>α <select aria-label="Alpha preset" value={[0.01,0.05].includes(settings.alpha)?settings.alpha:'custom'} onChange={e=>{if(e.target.value!=='custom')update({alpha:Number(e.target.value)});}}><option value="0.01">1%</option><option value="0.05">5%</option><option value="custom">Custom</option></select><StableTextField aria-label="Custom alpha" type="number" min="0.000001" max="0.999999" step="any" value={settings.alpha} onChange={e=>{const n=Number(e.target.value);if(n>0&&n<1)update({alpha:n});}}/></label>
    <label><input type="checkbox" checked={settings.negativeVariances} onChange={e=>update({negativeVariances:e.target.checked})}/> Negative latent variances</label>
  </div><small>Light red: opposite signs between a path estimate and its model-implied latent correlation. Bold red: p &gt; α. ⚠: negative latent variance. Missing correlations are not classified. Settings apply to this page, including comparisons.</small></details>;
}
