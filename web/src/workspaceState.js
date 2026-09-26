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
  for(const key of ['model_positions','positions','model_notes','model_sizes'])if(value[key]!==undefined&&(!value[key]||typeof value[key]!=='object'||Array.isArray(value[key])))throw Error(key+' must be an object.');
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
export function pageHasContent(page) {
  const layout=page.layout??{};
  // Conservatively include hidden/unavailable models, saved annotations and positions.
  // Catalog entries and their default size records alone do not make a page nonempty.
  return ['notes','decorations','edges','stacks','used_models','hidden_models'].some(key=>Array.isArray(layout[key])&&layout[key].length>0)
    || Object.keys(layout.model_notes??{}).length>0 || Object.keys(legacyPositions(layout)).length>0
    || Boolean(layout.retained_content && Object.keys(layout.retained_content).length);
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
