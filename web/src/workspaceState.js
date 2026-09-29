import { comparisonIdentity } from './cfaResults.js';
export const WORKSPACE_KEY = 'sem-multipage-workspace';
export const LEGACY_KEY = 'sem-model-layout';
export const PAGE_TYPES = {
  model: { label: 'Model workspace', icon: '▦', models: true, description: 'SEM / CFA models, results, and comparisons' },
  blank: { label: 'Blank workspace', icon: '□', models: false, description: 'Notes, shapes, containers, and connections' }
};
export function emptyLayout() {
  return { schema_version: '9.0', used_models: [], hidden_models: [], model_positions: {}, model_sizes: {}, model_notes: {}, stacks: [], notes: [], edges: [], decorations: [] };
}
export function validViewport(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.zoom) && value.zoom > 0 ? { x:value.x,y:value.y,zoom:value.zoom } : null;
}
export function legacyPositions(layout) {
  return layout.model_positions ?? layout.positions ?? (!layout.schema_version ? layout : {});
}
export function legacyUsed(layout) {
  return Array.isArray(layout.used_models) ? layout.used_models : [...new Set([...Object.keys(legacyPositions(layout)),...(layout.hidden_models??[]),...(layout.edges??[]).flatMap(edge=>[edge.source,edge.target])])];
}
export function mergeLegacyLayouts(file={},browser={}) {
  return { ...file,...browser, schema_version:'9.0',
    model_positions:{...legacyPositions(file),...legacyPositions(browser)},
    used_models:Array.isArray(browser.used_models)?browser.used_models:Array.isArray(file.used_models)?file.used_models:[...new Set([...legacyUsed(file),...legacyUsed(browser)])],
    stacks:Array.isArray(browser.stacks)?browser.stacks:Array.isArray(browser.used_models)?[]:file.stacks??[] };
}
export function validateLayout(value) {
  if(!value || typeof value!=='object' || Array.isArray(value))throw Error('A page layout must be a JSON object.');
  for(const key of ['used_models','hidden_models','stacks','notes','edges','decorations'])if(value[key]!==undefined&&!Array.isArray(value[key]))throw Error(key+' must be an array.');
  for(const key of ['model_positions','positions','model_notes','model_sizes','model_variants','matrix_settings'])if(value[key]!==undefined&&(!value[key]||typeof value[key]!=='object'||Array.isArray(value[key])))throw Error(key+' must be an object.');
  for(const key of ['notes','stacks','edges','decorations'])if(value[key]?.some(item=>!item||typeof item!=='object'||typeof item.id!=='string'))throw Error('Invalid '+key+' entry.');
  return value;
}
export function newPage(title,type='model',layout=emptyLayout()) {
  return {id:'page-'+crypto.randomUUID(),title:title.trim()||'Untitled page',type,layout};
}
export function normalizeWorkspace(value) {
  if(!value || value.kind!=='sem-workspace' || value.schema_version!=='10.0' || !Array.isArray(value.pages) || !value.pages.length)throw Error('This is not a supported workspace file.');
  const seen=new Set();
  const pages=value.pages.map(page=>{
    if(!page||typeof page.id!=='string'||!page.id||seen.has(page.id)||!PAGE_TYPES[page.type]||typeof page.title!=='string')throw Error('Every page needs a unique ID, a name, and a supported type.');
    seen.add(page.id);validateLayout(page.layout);
    if(page.type==='blank'&&hasModelContent(page.layout))throw Error('A blank page cannot contain model data.');
    return {...page,title:page.title.trim()||'Untitled page'};
  });
  return {...value,pages,active_page:seen.has(value.active_page)?value.active_page:pages[0].id};
}
function hasModelContent(layout) {
  return ['used_models','hidden_models','stacks'].some(key=>layout[key]?.length)||Object.keys(layout.model_notes??{}).length>0||Object.keys(layout.model_positions??{}).length>0;
}
// Positions and default sizes are reusable placement hints, not page content.
export function pageContentItems(page) {
  const l=page.layout??{}, items=[], stacks=l.stacks??[];
  const members=new Set(stacks.flatMap(s=>s.members??[]));
  const add=(kind,id,label)=>items.push({kind,id,key:kind+':'+id,label});
  for(const n of l.notes??[])add('note',n.id,'Canvas note: '+(n.data?.title||n.id));
  for(const n of l.decorations??[])add(n.type==='container'?'container':'shape',n.id,(n.type==='container'?'Container: ':'Shape: ')+(n.data?.title||n.id));
  for(const s of stacks)add('stack',s.id,(s.hidden?'Hidden stack: ':'Stack: ')+(s.title||s.id));
  for(const id of new Set([...legacyUsed(l),...(l.hidden_models??[])]))if(!members.has(id))add('model',id,(l.hidden_models?.includes(id)?'Hidden model: ':'Model: ')+id);
  for(const id of Object.keys(l.model_notes??{}))if(l.model_notes[id])add('model-note',id,'Model note: '+id);
  for(const e of l.edges??[])add('edge',e.id,'Arrow: '+e.source+' → '+e.target);
  if(l.retained_content&&Object.keys(l.retained_content).length)add('retained','retained','Other retained page data');
  return items;
}
export function pageContentSummary(page) {
  const counts={};for(const item of pageContentItems(page))counts[item.kind]=(counts[item.kind]??0)+1;
  const names={'note':'canvas note','model-note':'model note','edge':'arrow','retained':'retained data item'};
  return Object.entries(counts).map(([kind,n])=>n+' '+(names[kind]??kind)+(n===1?'':'s')).join(', ')||'No saved content';
}
export function pageHasContent(page) { return pageContentItems(page).length>0; }
// Explicit removal affects only this page, never the shared source files.
export function removePageContent(layout,item) {
  const l=structuredClone(layout), removed=new Set([item.id]);
  if(item.kind==='retained'){delete l.retained_content;return l;}
  if(item.kind==='model-note'){delete l.model_notes?.[item.id];return l;}
  if(item.kind==='edge'){l.edges=(l.edges??[]).filter(e=>e.id!==item.id);return l;}
  if(item.kind==='stack')for(const id of l.stacks?.find(s=>s.id===item.id)?.members??[])removed.add(id);
  l.used_models=legacyUsed(l).filter(id=>!removed.has(id));
  l.hidden_models=(l.hidden_models??[]).filter(id=>!removed.has(id));
  for(const key of ['model_positions','positions','model_sizes','model_notes'])for(const id of removed)if(l[key])delete l[key][id];
  for(const key of ['notes','decorations','stacks'])l[key]=(l[key]??[]).filter(n=>!removed.has(n.id));
  l.stacks=l.stacks.map(s=>({...s,members:(s.members??[]).filter(id=>!removed.has(id))}));
  l.decorations=l.decorations.map(n=>({...n,data:{...n.data,members:(n.data?.members??[]).filter(id=>!removed.has(id))}}));
  l.edges=(l.edges??[]).filter(e=>!removed.has(e.source)&&!removed.has(e.target));
  for(const id of removed)if(l.model_variants)delete l.model_variants[id];
  l.comparison_ids=(l.comparison_ids??[]).filter(id=>!removed.has(comparisonIdentity(id).modelId));
  return l;
}
export function canDeletePage(workspace,id) {
  const page=workspace.pages.find(item=>item.id===id);
  return Boolean(page&&workspace.pages.length>1&&!pageHasContent(page));
}
export function deleteEmptyPage(workspace,id) {
  if(!canDeletePage(workspace,id))throw Error('Only an empty page can be deleted, and at least one page must remain.');
  const pages=workspace.pages.filter(page=>page.id!==id);
  return {...workspace,pages,active_page:workspace.active_page===id?pages[0].id:workspace.active_page};
}
export function updatePageLayout(workspace,id,layout) {
  if(!workspace?.pages.some(page=>page.id===id))return workspace;
  return {...workspace,pages:workspace.pages.map(page=>page.id===id?{...page,layout}:page)};
}
export function workspaceFromLegacy(layout) {
  validateLayout(layout);const page=newPage('Page 1','model',layout);
  return {kind:'sem-workspace',schema_version:'10.0',active_page:page.id,pages:[page]};
}
