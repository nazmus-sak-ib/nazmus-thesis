import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createHistory, observeHistory, commitHistory, stepHistory, historySnapshot } from './pageHistory.js';

export function isTextEditor(target) {
  return Boolean(target?.closest?.('textarea, [contenteditable="true"], input:not([type="range"]):not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="button"])'));
}

export default function usePageHistory({ store, pageId, ready, signature, layout, restore }) {
  const [, refresh] = useState(0);
  const latest = useRef(null), timer = useRef(null), held = useRef(false), mounted = useRef(false);
  const snapshot = historySnapshot(layout);
  const notify = () => { if (mounted.current) refresh(n => n + 1); };
  const flush = () => {
    clearTimeout(timer.current);
    const history = store.current.get(pageId);
    if (history && commitHistory(history)) notify();
  };
  const schedule = (delay = 700) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };

  useLayoutEffect(() => {
    latest.current = { ready, restore, flush, schedule };
    if (!ready) return;
    let history = store.current.get(pageId);
    if (!history || history.signature !== signature) {
      history = createHistory(snapshot, signature);
      store.current.set(pageId, history);
      notify();
    } else {
      const previous = history.pending;
      observeHistory(history, snapshot);
      if (previous !== history.pending) {
        notify();
        if (!held.current) schedule();
      }
    }
  });

  function step(direction) {
    if (!latest.current?.ready || held.current) return;
    latest.current.flush();
    const history = store.current.get(pageId);
    if (!history) return;
    const document = stepHistory(history, direction);
    if (document) latest.current.restore(document);
    notify();
  }
  const actions = useRef(null);
  useLayoutEffect(() => { actions.current = step; });
  useEffect(() => {
    mounted.current = true;
    // Pointer capture and mouse-based resize libraries may finish outside .app.
    // Commit at the end of the gesture, never while a pointer is held down.
    const down = event => {
      if (!event.target.closest?.('.app')) return;
      latest.current.flush();
      held.current = !isTextEditor(event.target);
    };
    const up = () => { if (held.current) { held.current = false; latest.current.schedule(0); } };
    const key = event => {
      if (isTextEditor(event.target) || event.target.closest?.('[aria-modal="true"]') || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault(); event.stopPropagation();
      actions.current(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', up);
    return () => {
      mounted.current = false; latest.current.flush();
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', up);
    };
  }, []);

  const history = store.current.get(pageId);
  return { undo: () => step('undo'), redo: () => step('redo'),
    canUndo: ready && Boolean(history?.past.length || history?.pending),
    canRedo: ready && Boolean(history?.future.length && !history?.pending) };
}
