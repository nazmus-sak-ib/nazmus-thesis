export function contentMinZoom(boxes, viewport) {
  if (!boxes.length) return 0.5;
  const width=Math.max(...boxes.map(b=>b.x+b.width))-Math.min(...boxes.map(b=>b.x));
  const height=Math.max(...boxes.map(b=>b.y+b.height))-Math.min(...boxes.map(b=>b.y));
  return Math.max(0.005,Math.min(0.5,viewport.width/Math.max(1,width+80)*0.85,viewport.height/Math.max(1,height+80)*0.85));
}

export function clearStackEndpoints(props, isStack) {
  const routed={...props};
  for(const end of ['source','target']) {
    if(!isStack(props[end])) continue;
    const direction={left:[-1,0],right:[1,0],top:[0,-1],bottom:[0,1]}[props[end+'Position']]??[0,0];
    // The rear cards extend 13px beyond the node; leave another 7px of clearance.
    routed[end+'X']+=direction[0]*20;
    routed[end+'Y']+=direction[1]*20;
  }
  return routed;
}
