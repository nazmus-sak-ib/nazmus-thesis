export const STICKER_MIME = 'application/x-workspace-sticker';
export const STICKER_SHAPES = ['ribbon','tag','flag','star','warning','circle','shield'];
export const stickerKey = (model,variant) => JSON.stringify([model,variant??null]);
export function stickerModel(key) { try { return JSON.parse(key)[0]; } catch { return null; } }
export function stickerEntries(families) {
  return families.flatMap(family=>(family.stickers??[]).map(sticker=>({...sticker,family})));
}
export function applySticker(assignments,keys,stickerId,families,remove=false) {
  const entry=stickerEntries(families).find(s=>s.id===stickerId);
  if(!entry)return assignments;
  const siblings=new Set(entry.family.stickers.map(s=>s.id));
  const next={...assignments};
  for(const key of keys) {
    const before=Array.isArray(next[key])?next[key]:[];
    const ids=remove?before.filter(id=>id!==stickerId):[...before.filter(id=>id!==stickerId&&(entry.family.multiple||!siblings.has(id))),stickerId];
    if(ids.length)next[key]=ids;else delete next[key];
  }
  return next;
}
export function reorderStickerList(items,id,target) {
  if(id===target||!items.some(x=>x.id===id)||!items.some(x=>x.id===target))return items;
  const result=items.filter(x=>x.id!==id);
  result.splice(result.findIndex(x=>x.id===target),0,items.find(x=>x.id===id));
  return result;
}
export function enforceStickerFamilies(assignments,families) {
  const entries=new Map(stickerEntries(families).map(s=>[s.id,s]));
  return Object.fromEntries(Object.entries(assignments).map(([key,ids])=>{
    const seen=new Set();
    const kept=[...ids].reverse().filter(id=>{
      const entry=entries.get(id);
      if(!entry)return true;
      if(!entry.family.multiple&&seen.has(entry.family.id))return false;
      seen.add(entry.family.id);return true;
    }).reverse();
    return [key,kept];
  }));
}
export function validateStickerLibrary(families) {
  if(families===undefined)return;
  if(!Array.isArray(families))throw Error('Sticker families must be an array.');
  const ids=new Set();
  for(const family of families) {
    if(!family||typeof family.id!=='string'||ids.has(family.id)||typeof family.name!=='string'||!Array.isArray(family.stickers))throw Error('Invalid sticker family.');
    ids.add(family.id);
    for(const sticker of family.stickers) {
      if(!sticker||typeof sticker.id!=='string'||ids.has(sticker.id)||typeof sticker.name!=='string'||typeof sticker.code!=='string'||(sticker.note!==undefined&&typeof sticker.note!=='string'))throw Error('Invalid sticker.');
      ids.add(sticker.id);
    }
  }
}
