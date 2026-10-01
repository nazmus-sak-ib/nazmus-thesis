import {Children, cloneElement, useContext, useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {RowOrderContext} from './rowOrderContext.js';
import {orderedKeys,moveRow} from './rowOrder.js';

export default function OrderedRows({children}) {
  const context=useContext(RowOrderContext), dragging=useRef(null), body=useRef(null);
  const [preview,setPreview]=useState(null),[landed,setLanded]=useState(null);
  const flashTimer=useRef(null);
  useEffect(()=>{
    const cancel=event=>{if(event.key==='Escape'){dragging.current=null;setPreview(null);}};
    document.addEventListener('keydown',cancel);
    return ()=>{document.removeEventListener('keydown',cancel);clearTimeout(flashTimer.current);dragging.current=null;};
  },[]);
  useEffect(()=>{dragging.current=null;setPreview(null);setLanded(null);},[context?.scope]);
  useEffect(()=>{
    if(!preview)return;
    let frame;
    const tick=()=>{
      const drag=dragging.current;
      if(!drag)return;
      let parent=body.current?.parentElement;
      while(parent){
        const style=getComputedStyle(parent),rect=parent.getBoundingClientRect();
        if(/auto|scroll/.test(style.overflowY)&&parent.scrollHeight>parent.clientHeight){
          if(drag.x>=rect.left&&drag.x<=rect.right&&drag.y>=rect.top-20&&drag.y<=rect.bottom+20){
            const speed=drag.y<rect.top+44?-Math.ceil((rect.top+44-drag.y)/4):drag.y>rect.bottom-44?Math.ceil((drag.y-rect.bottom+44)/4):0;
            if(speed){parent.scrollTop+=Math.max(-18,Math.min(18,speed));updatePreview(drag);}
          }
          break;
        }
        parent=parent.parentElement;
      }
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(frame);
  },[Boolean(preview)]);

  const rows=Children.toArray(children),keys=rows.map(row=>row.key);
  const order=orderedKeys(keys,context?.orders[context.scope]);
  const byKey=new Map(rows.map(row=>[row.key,row]));
  function flash(key){clearTimeout(flashTimer.current);setLanded(key);flashTimer.current=setTimeout(()=>setLanded(null),1400);}
  function move(source,target,after){context.update(context.scope,moveRow(order,source,target,after));flash(source);}
  function updatePreview(drag){
    const tbody=body.current;
    if(!tbody)return;
    const visible=document.elementFromPoint(drag.x,drag.y);
    const table=tbody.closest('table');
    let target=null;
    if(visible && (table.contains(visible)||visible.contains(table))){
      const elements=[...tbody.querySelectorAll(':scope > tr[data-row-key]')];
      const row=elements.find(row=>drag.y<row.getBoundingClientRect().bottom)??elements.at(-1);
      if(row){const rect=row.getBoundingClientRect(),after=drag.y>rect.top+rect.height/2;target={key:row.dataset.rowKey,after,x:rect.left,y:after?rect.bottom:rect.top,width:rect.width};}
    }
    drag.target=target;
    setPreview({key:drag.key,x:drag.x,y:drag.y,cells:drag.cells,target});
  }
  function finish(cancel=false){
    const drag=dragging.current;dragging.current=null;setPreview(null);
    if(!cancel&&drag?.active&&drag.target)move(drag.key,drag.target.key,drag.target.after);
  }
  if(!context?.enabled)return <tbody>{children}</tbody>;
  return <><tbody ref={body}>{order.map((key,index)=>{
    const row=byKey.get(key),cells=Children.toArray(row.props.children);
    const handle=<button className="row-drag-handle" aria-label={`Move row ${index+1}`} title="Drag to reorder; Alt + Up/Down also moves this row. Escape cancels. Save workspace to keep the order."
      onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();const tr=event.currentTarget.closest('tr');dragging.current={key,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,cells:[...tr.cells].map(cell=>cell.innerText.replace(/^::/,''))};event.currentTarget.setPointerCapture(event.pointerId);}}
      onPointerMove={event=>{const drag=dragging.current;if(!drag)return;drag.x=event.clientX;drag.y=event.clientY;if(Math.hypot(drag.x-drag.startX,drag.y-drag.startY)>4)drag.active=true;if(drag.active)updatePreview(drag);}}
      onPointerUp={()=>finish()}
      onPointerCancel={()=>finish(true)}
      onLostPointerCapture={()=>{if(dragging.current)finish(true);}}
      onKeyDown={event=>{if(!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();const target=order[index+(event.key==='ArrowUp'?-1:1)];if(target)move(key,target,event.key==='ArrowDown');}}>::</button>;
    cells[0]=cloneElement(cells[0],{},handle,cells[0].props.children);
    return cloneElement(row,{'data-row-key':key,className:[row.props.className,preview?.key===key?'row-being-dragged':'',landed===key?'row-just-moved':''].filter(Boolean).join(' ')},cells);
  })}</tbody>{preview&&createPortal(<>
    <div className="row-drag-preview" style={{left:Math.max(8,Math.min(preview.x+16,window.innerWidth-280)),top:Math.max(8,Math.min(preview.y+16,window.innerHeight-64))}}><strong>Moving row</strong><div>{preview.cells.map((text,index)=><span key={index}>{text||'—'}</span>)}</div></div>
    {preview.target&&<div className="row-drop-line" style={{left:preview.target.x,top:preview.target.y,width:preview.target.width}}/>}
  </>,document.body)}</>;
}
