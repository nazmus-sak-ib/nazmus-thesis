export const SORT_OPTIONS = [['name-asc','Name: A–Z'],['name-desc','Name: Z–A'],['json-desc','JSON: newest first'],['json-asc','JSON: oldest first'],['svg-desc','SVG: newest first'],['svg-asc','SVG: oldest first']];
export function sortModels(items, mode = 'json-desc', all = items) {
  const [field, direction] = mode.split('-');
  const name = (a,b) => (a.data.title || a.id).localeCompare(b.data.title || b.id, undefined, {numeric:true}) || a.id.localeCompare(b.id);
  const date = node => {
    const members = node.type === 'stack' ? all.filter(n=>node.data.memberIds.includes(n.id)) : [node];
    const dates = members.map(n=>Date.parse(n.data[field === 'json' ? 'jsonModified' : 'svgModified'])).filter(Number.isFinite);
    return dates.length ? Math.max(...dates) : null;
  };
  return [...items].sort((a,b)=>{
    if(field === 'name') return name(a,b)*(direction === 'desc' ? -1 : 1);
    const x=date(a), y=date(b);
    if(x===null || y===null) return x===y ? name(a,b) : x===null ? 1 : -1;
    return (x-y)*(direction === 'desc' ? -1 : 1) || name(a,b);
  });
}
