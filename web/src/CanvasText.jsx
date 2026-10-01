import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { NodeResizer, useReactFlow } from '@xyflow/react';

// Keep browser selection intact while publishing edits to the canvas store.
export function StableTextField({ value, onChange, multiline, ...props }) {
  const ref = useRef(null);
  useEffect(()=>{if(ref.current && ref.current.value !== value) ref.current.value = value ?? '';},[value]);
  const Tag = multiline ? 'textarea' : 'input';
  return <Tag {...props} ref={ref} defaultValue={value ?? ''} onChange={onChange}/>;
}

export default function CanvasText({ id, data, selected, width = 300 }) {
  const { updateNodeData, updateNode } = useReactFlow();
  const [editing,setEditing] = useState(false);
  const [resizing,setResizing] = useState(false);
  const fontSize = (data.fontSize??32) * width / (data.baseWidth??300);
  useLayoutEffect(()=>{
    if(editing || resizing)return;
    const context=document.createElement('canvas').getContext('2d');
    context.font=`${data.bold?'bold':'normal'} ${fontSize}px Arial`;
    const lines=(data.text||'Double-click to edit').split('\n');
    const fittedWidth=Math.min(5000,Math.max(20,Math.ceil(Math.max(...lines.map(line=>context.measureText(line).width)))+4));
    const fittedHeight=Math.min(1000,Math.max(9,Math.ceil(lines.length*fontSize*1.2)+2));
    updateNode(id,node=>Math.abs(node.width-fittedWidth)<1 && Math.abs(node.height-fittedHeight)<1 ? node : ({...node,width:fittedWidth,height:fittedHeight,data:{...node.data,fontSize,baseWidth:fittedWidth}}));
  },[id,data.text,data.bold,fontSize,editing,resizing,updateNode]);
  return <div className="canvas-text" onDoubleClick={()=>setEditing(true)} style={{color:data.color,fontWeight:data.bold?'bold':'normal',textAlign:data.align??'left',textDecoration:data.underline?'underline':'none',fontSize}}>
    <NodeResizer isVisible={selected && !editing} keepAspectRatio minWidth={20} minHeight={9} maxWidth={5000} maxHeight={1000} onResizeStart={()=>setResizing(true)} onResizeEnd={()=>setResizing(false)}/>
    {editing ? <StableTextField multiline autoFocus className="nodrag nopan nowheel" value={data.text} onChange={e=>updateNodeData(id,{text:e.target.value})} onBlur={()=>setEditing(false)} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')setEditing(false);}}/> : <span>{data.text || 'Double-click to edit'}</span>}
  </div>;
}
