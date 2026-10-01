import {createPortal} from 'react-dom';
import {useState,useRef} from 'react';
import {STICKER_MIME,STICKER_SHAPES,stickerEntries,reorderStickerList} from './stickers.js';

const positions=[['top-left','Top left'],['top-right','Top right'],['bottom-left','Bottom left'],['bottom-center','Bottom center'],['bottom-right','Bottom right'],['center-right','Center right'],['center-left','Center left']];
const paths={ribbon:'M5 2H43V46L24 36 5 46Z',tag:'M2 4H34L47 24 34 44H2Z',flag:'M3 3H46L37 24 46 45H3Z',star:'M24 1 31 16 47 18 35 30 39 47 24 39 9 47 13 30 1 18 17 16Z',warning:'M24 2 47 44H1Z',shield:'M3 3H45V25Q42 40 24 47Q6 40 3 25Z'};
export function StickerBadge({family,sticker}) {
  const color=/^#[0-9a-f]{6}$/i.test(sticker.color)?sticker.color:/^#[0-9a-f]{6}$/i.test(family.color)?family.color:'#8055b8';
  const size={small:28,medium:38,large:50}[sticker.size]??38;
  const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
  const ink=rgb[0]*.299+rgb[1]*.587+rgb[2]*.114>155?'#172033':'#ffffff';
  return <span className="sticker-badge" style={{width:size,height:size}} aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false">{family.shape==='circle'?<circle cx="24" cy="24" r="23" fill={color}/>:<path d={paths[family.shape]??paths.ribbon} fill={color}/>}</svg><span style={{color:ink,fontSize:size*0.29}}>{sticker.code.slice(0,4)}</span></span>;
}
function StickerChip({entry,onRemove}) {
  const [preview,setPreview]=useState(null);
  const show=e=>{const r=e.currentTarget.getBoundingClientRect();setPreview({left:Math.max(8,Math.min(r.left,window.innerWidth-286)),top:Math.max(8,Math.min(r.bottom+6,window.innerHeight-220))});};
  return <button className="sticker-chip nodrag nopan" aria-label={entry.name+' — '+entry.family.name} onMouseEnter={show} onMouseLeave={()=>setPreview(null)} onFocus={show} onBlur={()=>setPreview(null)} onContextMenu={e=>{e.preventDefault();e.stopPropagation();setPreview(null);onRemove(entry.id);}}>
    <StickerBadge family={entry.family} sticker={entry}/>{preview&&createPortal(<span className="sticker-tooltip" style={preview} role="tooltip"><strong>{entry.name}</strong><small>{entry.family.name}</small>{entry.note&&<span>{entry.note}</span>}<small>Right-click to remove</small></span>,document.body)}
  </button>;
}
export function ModelStickers({data}) {
  return <>{positions.map(([position])=>{const entries=(data.stickers??[]).filter(s=>(s.position??'top-left')===position);return entries.length?<StickerGroup key={position} position={position} entries={entries} onRemove={data.onRemoveSticker}/>:null;})}</>;
}
function StickerGroup({position,entries,onRemove}) {
  const [expanded,setExpanded]=useState(false);
  if(!entries.length)return null;
  return <div className={"model-stickers nodrag nopan stickers-"+position} onPointerDown={e=>e.stopPropagation()}>
    {entries.slice(0,3).map(entry=><StickerChip key={entry.id} entry={entry} onRemove={onRemove}/>)}
    {entries.length>3&&<div className="sticker-overflow" onMouseEnter={()=>setExpanded(true)} onMouseLeave={()=>setExpanded(false)}><button className="sticker-more" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>+{entries.length-3}</button>{expanded&&<div className="sticker-overflow-list">{entries.slice(3).map(entry=><StickerChip key={entry.id} entry={entry} onRemove={onRemove}/>)}</div>}</div>}
  </div>;
}
export function StickerLibrary({families,onChange,onClose,onDropOnModel}) {
  const [draft,setDraft]=useState(null),[query,setQuery]=useState('');
  const drag=useRef(null),skipClick=useRef(false);
  const [dragPosition,setDragPosition]=useState(null);
  function startDrag(event,id,familyId=null) {
    if(event.button!==0)return;
    skipClick.current=false;drag.current={id,familyId,x:event.clientX,y:event.clientY,moved:false};
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event) {
    const value=drag.current;if(!value)return;
    if(Math.hypot(event.clientX-value.x,event.clientY-value.y)>6)value.moved=true;
    if(value.moved)setDragPosition({x:event.clientX,y:event.clientY});
  }
  function finishDrag(event,cancel=false) {
    const value=drag.current;
    if(value?.moved&&!cancel){
      skipClick.current=true;
      const hit=document.elementFromPoint(event.clientX,event.clientY);
      if(value.familyId){
        const node=hit?.closest('.react-flow__node');
        if(node)onDropOnModel(node.dataset.id,value.id);
        else {const target=hit?.closest('[data-sticker-id]')?.dataset.stickerId;const family=families.find(f=>f.id===value.familyId);if(target&&family)updateFamily(family.id,{stickers:reorderStickerList(family.stickers,value.id,target)});}
      }else {const target=hit?.closest('[data-family-id]')?.dataset.familyId;if(target)onChange(reorderStickerList(families,value.id,target));}
    }
    drag.current=null;setDragPosition(null);
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const pointerHandlers={onPointerMove:moveDrag,onPointerUp:e=>finishDrag(e),onPointerCancel:e=>finishDrag(e,true),onLostPointerCapture:()=>{drag.current=null;setDragPosition(null);}};
  const updateFamily=(id,change)=>onChange(families.map(f=>f.id===id?{...f,...change}:f));
  function submit(e) {
    e.preventDefault();
    if(draft.type==='family') {
      const value={id:draft.id??crypto.randomUUID(),name:draft.name.trim(),shape:draft.shape,color:draft.color,multiple:draft.multiple,stickers:families.find(f=>f.id===draft.id)?.stickers??[]};
      onChange(draft.id?families.map(f=>f.id===draft.id?value:f):[...families,value]);
    } else {
      const family=families.find(f=>f.id===draft.familyId);if(!family)return;
      const value={id:draft.id??crypto.randomUUID(),name:draft.name.trim(),code:draft.code.trim(),note:draft.note,color:draft.color??'',size:draft.size??'medium',position:draft.position??'top-left'};
      updateFamily(family.id,{stickers:draft.id?family.stickers.map(s=>s.id===draft.id?value:s):[...family.stickers,value]});
    }
    setDraft(null);
  }
  return <aside className="sticker-library" aria-label="Sticker library" onKeyDown={e=>e.stopPropagation()}>
    <header><h2>Sticker library</h2><button onClick={onClose} aria-label="Close sticker library">×</button></header>
    <p>Drag stickers onto a model. Library shared across pages; assignments belong to this page.</p>
    <button onClick={()=>setDraft({type:'family',name:'',shape:'ribbon',color:'#8055b8',multiple:false})}>+ Family</button>
    <input aria-label="Search stickers" placeholder="Search stickers…" value={query} onChange={e=>setQuery(e.target.value)}/>
    {families.map((family,index)=><section key={family.id} data-family-id={family.id} className="sticker-family" onDragOver={e=>{if(e.dataTransfer.types.includes('application/x-sticker-family'))e.preventDefault();}} onDrop={e=>{const id=e.dataTransfer.getData('application/x-sticker-family');if(id){e.preventDefault();e.stopPropagation();onChange(reorderStickerList(families,id,family.id));}}}>
      <header><strong style={{touchAction:"none"}} onPointerDown={e=>startDrag(e,family.id)} {...pointerHandlers} title="Drag to reorder families">{family.name}</strong><button aria-label={'Edit family '+family.name} onClick={()=>setDraft({...family,type:'family'})}>Edit</button><button disabled={!index} aria-label={'Move '+family.name+' up'} onClick={()=>onChange(reorderStickerList(families,family.id,families[index-1].id))}>↑</button></header>
      {family.stickers.filter(s=>(s.name+' '+s.code+' '+s.note).toLowerCase().includes(query.toLowerCase())).map(sticker=><div className="sticker-library-item" data-sticker-id={sticker.id} key={sticker.id} onDragOver={e=>e.preventDefault()} onDrop={e=>{const id=e.dataTransfer.getData(STICKER_MIME);if(family.stickers.some(s=>s.id===id)){e.preventDefault();e.stopPropagation();updateFamily(family.id,{stickers:reorderStickerList(family.stickers,id,sticker.id)});}}}>
        <button style={{touchAction:"none"}} title="Drag onto a model, or drag above another sticker to reorder" onPointerDown={e=>startDrag(e,sticker.id,family.id)} {...pointerHandlers} onClick={()=>{if(skipClick.current){skipClick.current=false;return;}setDraft({...sticker,type:"sticker",familyId:family.id});}}><StickerBadge family={family} sticker={sticker}/><span>{sticker.name}<small>{sticker.code}</small></span></button>
        <button aria-label={'Edit sticker '+sticker.name} onClick={()=>setDraft({...sticker,type:'sticker',familyId:family.id})}>Edit</button>
      </div>)}
      <button onClick={()=>setDraft({type:'sticker',familyId:family.id,name:'',code:'',note:''})}>+ Sticker</button>
    </section>)}
    {!families.length&&<p>Create a family, then add its stickers.</p>}
    {dragPosition&&createPortal(<div className="sticker-drag-hint" style={{left:dragPosition.x+12,top:dragPosition.y+12}}>Drop on a model or reorder in the library</div>,document.body)}
    {draft&&<form className="sticker-editor" onSubmit={submit} aria-label={draft.type==='family'?'Edit sticker family':'Edit sticker'}>
      <h3>{draft.type==='family'?'Sticker family':'Sticker'}</h3>
      <label>Name<input autoFocus required maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      {draft.type==='family'?<><div className="sticker-shape-options">{STICKER_SHAPES.map(shape=><button type="button" key={shape} aria-label={shape} aria-pressed={draft.shape===shape} onClick={()=>setDraft({...draft,shape})}><StickerBadge family={{...draft,shape}} sticker={{code:'D3'}}/><small>{shape}</small></button>)}</div><label>Color<input type="color" value={draft.color} onChange={e=>setDraft({...draft,color:e.target.value})}/></label><label><input type="checkbox" checked={draft.multiple} onChange={e=>setDraft({...draft,multiple:e.target.checked})}/> Allow multiple stickers from this family per model</label><small>When turned off, only the most recently assigned sticker from this family is kept on each model or variant.</small></>:<><label>Short code (1–4 characters)<input required maxLength={4} value={draft.code} onChange={e=>setDraft({...draft,code:e.target.value})}/></label><label><input type="checkbox" checked={!draft.color} onChange={e=>setDraft({...draft,color:e.target.checked?'':families.find(f=>f.id===draft.familyId)?.color??'#8055b8'})}/> Use family color</label>
      <label>Sticker color<input type="color" disabled={!draft.color} value={draft.color||families.find(f=>f.id===draft.familyId)?.color||'#8055b8'} onChange={e=>setDraft({...draft,color:e.target.value})}/></label>
      <label>Size<select value={draft.size??'medium'} onChange={e=>setDraft({...draft,size:e.target.value})}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
      <label>Position<select value={draft.position??'top-left'} onChange={e=>setDraft({...draft,position:e.target.value})}>{positions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Note<textarea value={draft.note??''} onChange={e=>setDraft({...draft,note:e.target.value})}/></label><StickerBadge family={families.find(f=>f.id===draft.familyId)??{}} sticker={draft}/></>}
      <button type="button" onClick={()=>setDraft(null)}>Cancel</button><button type="submit" disabled={!draft.name.trim()||(draft.type==='sticker'&&!draft.code.trim())}>Save</button>
    </form>}
  </aside>;
}
export function StickerAction({action,families,scopes,onApply,onClose}) {
  const [chosen,setChosen]=useState(action.stickerId??''),[scope,setScope]=useState('current');
  return <div className="stack-dialog-backdrop" onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')onClose();}}><form className="stack-dialog" role="dialog" aria-modal="true" aria-label={action.remove?'Remove sticker':'Apply sticker'} onSubmit={e=>{e.preventDefault();onApply(chosen,scope);}}>
    <h2>{action.remove?'Remove sticker':'Apply sticker'}</h2><p>{action.title}</p>
    <label>Sticker<select required value={chosen} onChange={e=>setChosen(e.target.value)} disabled={Boolean(action.stickerId)}><option value="">Choose a sticker</option>{stickerEntries(families).map(s=><option key={s.id} value={s.id}>{s.family.name} · {s.code} · {s.name}</option>)}</select></label>
    <fieldset><legend>Apply to</legend>{scopes.map(s=><label key={s.id}><input type="radio" name="sticker-scope" checked={scope===s.id} onChange={()=>setScope(s.id)}/>{s.label}</label>)}</fieldset>
    <p>{action.remove?'Remove this sticker from the selected scope.':'A family allowing only one sticker replaces that family’s existing sticker.'} Other pages are unaffected.</p>
    <button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={!chosen}>{action.remove?'Remove sticker':'Add sticker'}</button>
  </form></div>;
}
