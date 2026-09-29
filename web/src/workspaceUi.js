// Navigation alone is not a document edit. Page order and every saved layout
// field are significant; object key ordering is not.
export function workspaceFingerprint(workspace) {
  if (!workspace) return null;
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
  const { active_page, ...document } = workspace;
  void active_page;
  document.pages=workspace.pages?.map(page=>{
    const {viewport,...layout}=page.layout??{};
    void viewport;
    const used=new Set([...(layout.used_models??[]),...Object.keys(layout.model_positions??{}),...(layout.stacks??[]).flatMap(s=>s.members??[])]);
    for(const key of ['used_models','hidden_models','stacks','notes','edges','decorations','comparison_ids'])layout[key]??=[];
    for(const key of ['model_positions','model_notes','model_variants','matrix_settings'])layout[key]??={};
    layout.model_sizes=Object.fromEntries(Object.entries(layout.model_sizes??{}).filter(([id])=>used.has(id)));
    return {...page,layout};
  });
  return JSON.stringify(canonical(document));
}

export function reorderPages(workspace, movingId, targetId, after = false) {
  if (movingId===targetId || !workspace.pages.some(p=>p.id===movingId) || !workspace.pages.some(p=>p.id===targetId)) return workspace;
  const moving=workspace.pages.find(p=>p.id===movingId), pages=workspace.pages.filter(p=>p.id!==movingId);
  const index=pages.findIndex(p=>p.id===targetId)+(after?1:0);
  pages.splice(index,0,moving);
  return {...workspace,pages};
}
