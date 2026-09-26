import { useCallback, useEffect, useRef, useState } from 'react';
import { WORKSPACE_KEY, LEGACY_KEY, PAGE_TYPES, newPage, normalizeWorkspace, workspaceFromLegacy, mergeLegacyLayouts, validateLayout, updatePageLayout, canDeletePage, deleteEmptyPage } from './workspaceState.js';
const BASE=import.meta.env.BASE_URL;
export default function Workspace({ Canvas }) {
  const [workspace,setWorkspace]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem('sem-pages-collapsed')==='true';}catch{return false;}});
  const [dialog,setDialog]=useState(null),[menu,setMenu]=useState(null),[busy,setBusy]=useState(false),[generation,setGeneration]=useState(0);
  const workspaceRef=useRef(null),canvasApi=useRef(null),fileHandle=useRef(null),pending=useRef(false),bootstrap=useRef(0);
  const commit=useCallback(value=>{workspaceRef.current=value;setWorkspace(value);},[]);
  useEffect(()=>{
    let cancelled=false;const ticket=++bootstrap.current;
    async function load(){
      try {
        let saved=null,legacy=null;
        try{saved=localStorage.getItem(WORKSPACE_KEY);legacy=localStorage.getItem(LEGACY_KEY);}catch{/* File load remains available. */}
        if(saved){const value=normalizeWorkspace(JSON.parse(saved));if(!cancelled&&ticket===bootstrap.current)commit(value);return;}
        let file={};
        try{const response=await fetch(BASE+'layout.json',{cache:'no-store'});if(response.ok)file=await response.json();else if(response.status!==404)throw Error('Could not read layout.json ('+response.status+').');}
        catch(loadError){if(!legacy)throw loadError;}
        const value=file.kind==='sem-workspace'?normalizeWorkspace(file):workspaceFromLegacy(mergeLegacyLayouts(validateLayout(file),legacy?validateLayout(JSON.parse(legacy)):{}));
        if(cancelled||ticket!==bootstrap.current)return;
        if(legacy){try{if(!localStorage.getItem(LEGACY_KEY+'-before-pages'))localStorage.setItem(LEGACY_KEY+'-before-pages',legacy);}catch{setNotice('Browser migration backup unavailable. Save a workspace file.');}}
        commit(value);
      }catch(loadError){if(!cancelled&&ticket===bootstrap.current)setError('Workspace not loaded: '+loadError.message+' Your existing browser backup has not been replaced. Use Open workspace to recover.');}
    }
    load();return()=>{cancelled=true;};
  },[commit]);
  useEffect(()=>{
    if(!workspace)return;
    try{localStorage.setItem(WORKSPACE_KEY,JSON.stringify(workspace));}
    catch{setError('Browser autosave is unavailable or full. Use Save workspace to preserve every page.');}
  },[workspace]);
  const recordLayout=useCallback((id,layout)=>{
    const current=workspaceRef.current;if(!current)return;
    commit(updatePageLayout(current,id,layout));
  },[commit]);
  function capture(){
    const current=workspaceRef.current;if(!current)return null;
    const api=canvasApi.current;
    return api?.ready && current.pages.some(page=>page.id===api.id) ? updatePageLayout(current,api.id,api.snapshot()) : current;
  }
  function switchPage(id){const current=capture();if(!current||current.active_page===id)return;commit({...current,active_page:id});setMenu(null);}
  function togglePages(){const next=!collapsed;setCollapsed(next);try{localStorage.setItem('sem-pages-collapsed',String(next));}catch{/* optional preference */}}
  function createDialog(){const current=capture();if(!current)return;commit(current);let n=current.pages.length+1;while(current.pages.some(p=>p.title.toLowerCase()==='page '+n))n++;setDialog({mode:'create',title:'Page '+n,type:'model'});setMenu(null);}
  function submitDialog(event){
    event.preventDefault();const current=capture();if(!current)return;
    if(dialog.mode==='delete'){
      try{commit(deleteEmptyPage(current,dialog.id));setDialog(null);setMenu(null);}catch(deleteError){setDialog({...dialog,error:deleteError.message});}
      return;
    }
    const title=dialog.title.trim();if(!title){setDialog({...dialog,error:'Enter a page name.'});return;}
    if(current.pages.some(page=>page.id!==dialog.id&&page.title.toLowerCase()===title.toLowerCase())){setDialog({...dialog,error:'Another page already uses this name.'});return;}
    if(dialog.mode==='create'){const page=newPage(title,dialog.type);commit({...current,pages:[...current.pages,page],active_page:page.id});}
    else commit({...current,pages:current.pages.map(page=>page.id===dialog.id?{...page,title}:page)});
    setDialog(null);
  }
  function deletePage(id){
    const current=capture();if(!current)return;
    if(!canDeletePage(current,id)){setNotice('This page cannot be deleted: it contains saved content, or it is the last page.');return;}
    const page=current.pages.find(p=>p.id===id);
    setDialog({mode:'delete',id,title:page.title});setMenu(null);
  }
  async function chooseFile(){
    if(!window.showOpenFilePicker)throw Error('Use Chrome or Edge to open workspace files.');
    const [handle]=await window.showOpenFilePicker({types:[{description:'JSON files',accept:{'application/json':['.json']}}],multiple:false});
    const value=JSON.parse(await (await handle.getFile()).text());return {handle,value};
  }
  async function openWorkspace(){
    if(pending.current)return;pending.current=true;setBusy(true);
    try{
      const {handle,value}=await chooseFile();const incoming=normalizeWorkspace(value);
      if(workspaceRef.current&&!window.confirm('Replace all currently open pages with this workspace? Save workspace first if you want to keep the current version.'))return;
      const current=capture();if(current){try{localStorage.setItem(WORKSPACE_KEY+'-before-open',JSON.stringify(current));}catch{/* Export is also available. */}}
      bootstrap.current++;canvasApi.current=null;fileHandle.current=handle;setGeneration(n=>n+1);commit(incoming);setError('');setNotice('Workspace opened.');setMenu(null);
    }catch(openError){if(openError.name!=='AbortError')setError(openError.message);}
    finally{pending.current=false;setBusy(false);}
  }
  async function importLayout(){
    if(pending.current)return;pending.current=true;setBusy(true);
    try{
      const {value}=await chooseFile();if(value.kind==='sem-workspace')throw Error('This file contains a whole workspace. Use Open workspace instead.');
      validateLayout(value);const current=capture();
      if(!current){bootstrap.current++;commit(workspaceFromLegacy(mergeLegacyLayouts(value,{})));setError('');setNotice('Layout recovered as Page 1.');return;}
      let title='Imported layout',n=2;while(current.pages.some(p=>p.title===title))title='Imported layout '+n++;
      const page=newPage(title,'model',mergeLegacyLayouts(value,{}));commit({...current,pages:[...current.pages,page],active_page:page.id});setNotice('Layout imported as a new page. Existing pages were preserved.');
    }catch(importError){if(importError.name!=='AbortError')setError(importError.message);}
    finally{pending.current=false;setBusy(false);}
  }
  async function saveWorkspace(){
    if(pending.current)return;const current=capture();if(!current)return;
    commit(current);const contents=JSON.stringify(current,null,2);pending.current=true;setBusy(true);
    try{
      let handle=fileHandle.current;
      if(!handle&&window.showSaveFilePicker)handle=await window.showSaveFilePicker({suggestedName:'workspace.json',types:[{description:'Workspace JSON',accept:{'application/json':['.json']}}]});
      if(handle){const stream=await handle.createWritable();try{await stream.write(contents);await stream.close();}catch(writeError){try{await stream.abort();}catch{/* original error */}throw writeError;}fileHandle.current=handle;}
      else {const url=URL.createObjectURL(new Blob([contents],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='workspace.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
      setNotice('Workspace saved — all pages included.');
    }catch(saveError){if(saveError.name!=='AbortError')setError('Could not save workspace: '+saveError.message);}
    finally{pending.current=false;setBusy(false);}
  }
  const active=workspace?.pages.find(page=>page.id===workspace.active_page);
  return <div className="workspace-shell">
    <aside className={'pages-sidebar'+(collapsed?' collapsed':'')} aria-label="Pages">
      <div className="pages-heading"><button aria-label={collapsed?'Expand pages':'Collapse pages'} title={collapsed?'Expand pages':'Collapse pages'} onClick={togglePages}>{collapsed?'▸':'◂'}</button>{!collapsed&&<strong>Pages</strong>}</div>
      <button className="new-page-button" title="New page" disabled={!workspace||busy} onClick={createDialog}>{collapsed?'+':'+ New page'}</button>
      <nav className="pages-list" aria-label="Workspace pages">{workspace?.pages.map((page,index)=>{
        const deletable=canDeletePage(workspace,page.id);
        return <div key={page.id} className={'page-entry'+(page.id===active?.id?' active':'')}>
          <button className="page-switch" aria-current={page.id===active?.id?'page':undefined} title={page.title+' — '+PAGE_TYPES[page.type].label} disabled={busy}
            onClick={()=>switchPage(page.id)} onContextMenu={event=>{event.preventDefault();setCollapsed(false);setMenu(page.id);}}>
            <span>{collapsed?index+1:PAGE_TYPES[page.type].icon}</span>{!collapsed&&<span>{page.title}<small>{PAGE_TYPES[page.type].label}</small></span>}
          </button>
          {!collapsed&&<button className="page-more" aria-label={'Options for '+page.title} onClick={()=>setMenu(menu===page.id?null:page.id)}>⋯</button>}
          {menu===page.id&&!collapsed&&<div className="page-options">
            <button disabled={busy} onClick={()=>{setDialog({mode:'rename',id:page.id,title:page.title,type:page.type});setMenu(null);}}>Rename</button>
            <button disabled={!deletable||busy} title={deletable?'Delete empty page':workspace.pages.length===1?'Keep at least one page':'Page contains saved content'} onClick={()=>deletePage(page.id)}>Delete empty page</button>
            {!deletable&&<small>{workspace.pages.length===1?'At least one page must remain.':'Contains content; deletion is locked.'}</small>}
          </div>}
        </div>;
      })}</nav>
      <div className="workspace-file-tools">
        <button disabled={!workspace||busy} onClick={saveWorkspace} title="Save all pages">{collapsed?'⇩':'Save workspace'}</button>
        <button disabled={busy} onClick={openWorkspace} title="Open a workspace, replacing all pages">{collapsed?'⇧':'Open workspace'}</button>
        <button disabled={busy} onClick={importLayout} title="Import an old layout as a new page">{collapsed?'⊕':'Import layout as page'}</button>
      </div>
    </aside>
    <main className="workspace-main">
      <header className="workspace-page-heading"><strong>{active?.title??'Workspace'}</strong><span>{active?PAGE_TYPES[active.type].label:'Loading…'}</span>{busy&&<span role="status">Working…</span>}</header>
      {error&&<div className="workspace-message error-message" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}
      {notice&&<div className="workspace-message" role="status">{notice}<button aria-label="Dismiss message" onClick={()=>setNotice('')}>×</button></div>}
      {active&&<Canvas key={generation+':'+active.id} pageId={active.id} pageType={active.type} initialLayout={active.layout}
        onLayoutChange={recordLayout} controllerRef={canvasApi} />}
    </main>
    {dialog&&<div className="page-dialog-backdrop" onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape')setDialog(null);}}>
      <form className="page-dialog" role="dialog" aria-modal="true" aria-label={dialog.mode==='create'?'New page':dialog.mode==='delete'?'Delete empty page':'Rename page'} onSubmit={submitDialog}>
        <h2>{dialog.mode==='create'?'New page':dialog.mode==='delete'?'Delete empty page':'Rename page'}</h2>
        {dialog.mode==='delete'?<p>Delete the empty page “{dialog.title}”? This will not affect other pages.</p>:<label>Name<input autoFocus maxLength={120} value={dialog.title} onChange={event=>setDialog({...dialog,title:event.target.value,error:null})}/></label>}
        {dialog.mode==='create'&&<><label>Type<select value={dialog.type} onChange={event=>setDialog({...dialog,type:event.target.value})}>{Object.entries(PAGE_TYPES).map(([key,type])=><option key={key} value={key}>{type.label}</option>)}</select></label><p>{PAGE_TYPES[dialog.type].description}</p></>}
        {dialog.error&&<p role="alert">{dialog.error}</p>}
        <div><button type="button" onClick={()=>setDialog(null)}>Cancel</button><button type="submit">{dialog.mode==='create'?'Create page':dialog.mode==='delete'?'Delete empty page':'Rename'}</button></div>
      </form>
    </div>}
  </div>;
}

