// Page-only, session-only history. Source files, viewport and comparison UI are
// deliberately outside the undoable document.
export function historySnapshot(layout) {
  const { viewport, comparison_ids, ...document } = layout;
  void viewport; void comparison_ids;
  return JSON.stringify(document);
}

export function createHistory(snapshot, signature = '') {
  return { past: [], present: snapshot, future: [], pending: null, signature };
}

export function observeHistory(history, snapshot) {
  history.pending = snapshot === history.present ? null : snapshot;
}

function trimHistory(history) {
  while (history.past.length > 60) history.past.shift();
  // Strings use roughly two bytes per character. Bound large rich-text histories.
  let size = [history.present, ...history.past, ...history.future].reduce((n, s) => n + s.length * 2, 0);
  while (size > 16 * 1024 * 1024 && history.past.length) size -= history.past.shift().length * 2;
}

export function commitHistory(history) {
  if (history.pending === null) return false;
  history.past.push(history.present);
  history.present = history.pending;
  history.pending = null;
  history.future = [];
  trimHistory(history);
  return true;
}

export function stepHistory(history, direction) {
  commitHistory(history);
  const from = direction === 'undo' ? history.past : history.future;
  const to = direction === 'undo' ? history.future : history.past;
  if (!from.length) return null;
  to.push(history.present);
  history.present = from.pop();
  return JSON.parse(history.present);
}
