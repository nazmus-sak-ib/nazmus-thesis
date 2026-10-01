import {useLayoutEffect,useRef} from 'react';
import {createPortal} from 'react-dom';

// Screen-space menus must fit independently of the canvas zoom and pan.
export default function ViewportMenu({style={},children,...props}) {
  const ref=useRef(null);
  const {left=12,top=12}=style;
  useLayoutEffect(()=>{
    const element=ref.current;
    function position(){
      const viewport=window.visualViewport;
      const x=viewport?.offsetLeft??0,y=viewport?.offsetTop??0;
      const width=viewport?.width??window.innerWidth,height=viewport?.height??window.innerHeight;
      element.style.maxHeight=`${Math.max(1,height-24)}px`;
      element.style.maxWidth=`${Math.max(1,width-24)}px`;
      const bounds=element.getBoundingClientRect();
      element.style.left=`${Math.max(x+12,Math.min(left,x+width-bounds.width-12))}px`;
      element.style.top=`${Math.max(y+12,Math.min(top,y+height-bounds.height-12))}px`;
    }
    position();
    const observer=new ResizeObserver(position);observer.observe(element);
    window.addEventListener('resize',position);
    window.visualViewport?.addEventListener('resize',position);
    window.visualViewport?.addEventListener('scroll',position);
    return ()=>{observer.disconnect();window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);};
  },[left,top]);
  return createPortal(<div {...props} ref={ref} style={{...style,maxHeight:'calc(100dvh - 24px)'}} onWheel={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>{children}</div>,document.body);
}
