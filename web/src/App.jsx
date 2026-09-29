import { MatrixSettingsContext } from './matrixContext.js';
import { CFA_VIEWS, variantsOf, selectResult, comparisonKey, comparisonIdentity, normalizeCfaData, cfaViewAvailable, reliabilityRows } from './cfaResults.js';
import CfaView from './CfaViews.jsx';
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { useId } from 'react';
import { createPortal } from 'react-dom';

import {
  ReactFlow,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Background,
  Controls,
  Handle,
  Position,
  ConnectionMode,
  MarkerType,
  NodeResizer,
  addEdge,
  applyNodeChanges,
  useNodesState,
  useEdgesState,
  useReactFlow
} from '@xyflow/react';

import { Rnd } from 'react-rnd';

import '@xyflow/react/dist/style.css';
import './App.css';
import Workspace from './Workspace.jsx';
import usePageHistory from './usePageHistory.js';
import { closestArrowEnd, arrowSnapPoints, snapArrowEndpoint, reattachArrow } from './arrowReconnect.js';
import { PAGE_TYPES, validViewport } from './workspaceState.js';

const BASE = import.meta.env.BASE_URL;


// ======================================================
// Connection handles
// ======================================================

function ConnectionHandles() {
  return (
    <>
      {/* Keep legacy target IDs so saved arrows still resolve. Loose connections
          use the four visible handles for either end of new/repositioned arrows. */}
      <Handle className="legacy-connection-handle" id="target-top" type="target" position={Position.Top} />
      <Handle className="legacy-connection-handle" id="target-left" type="target" position={Position.Left} />
      <Handle id="source-top" type="source" position={Position.Top} />
      <Handle id="source-left" type="source" position={Position.Left} />
      <Handle id="source-right" type="source" position={Position.Right} />
      <Handle id="source-bottom" type="source" position={Position.Bottom} />
    </>
  );
}

// ======================================================
// Model node
// ======================================================

// Exported metadata is optional. Unknown settings stay unknown, rather than
// being silently converted to FALSE, continuous, or a guessed estimator.
function resultRows(value) {
  return Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
}

function normalizeResultData(value) {
  value = normalizeCfaData(value);
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const data = { ...source, metadata: source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata) ? source.metadata : {} };
  for (const key of ['sample_size', 'missing_patterns', 'fit_measures', 'parameters', 'r_squared', 'modification_indices']) {
    data[key] = resultRows(source[key]);
  }
  return data;
}

function settingText(value, fallback = 'Not exported') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (Array.isArray(value)) return value.map(item => settingText(item, '')).filter(Boolean).join(', ') || fallback;
  return fallback;
}

function parameterRows(data, section) {
  if(section==='standardized')return resultRows(data?.standardized_solution).map(row=>({...row,est:row['est.std']}));
  const operators = { threshold: '|', loading: '=~', regression: '~' };
  return resultRows(data?.parameters).filter(row => row.section === section ||
    (!row.section && operators[section] && row.op === operators[section]) ||
    (section === 'threshold' && row.op === '|') ||
    (section === 'defined' && row.op === ':=') ||
    (!row.section && row.op === '~~' && ((section === 'variance' && row.lhs === row.rhs) || (section === 'covariance' && row.lhs !== row.rhs))));
}

function getMethodSummary(data) {
  const metadata = data?.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata) ? data.metadata : {};
  const ordered = (Array.isArray(metadata.ordered_variables) ? metadata.ordered_variables
    : typeof metadata.ordered_variables === 'string' ? [metadata.ordered_variables] : [])
    .filter(value => typeof value === 'string' && value.trim());
  const declared = settingText(metadata.data_treatment, '').toLowerCase();
  const hasThresholds = parameterRows(data, 'threshold').length > 0;
  const hasPaths = parameterRows(data, 'regression').length > 0;
  const exportedCount = metadata.number_ordered_variables;
  const orderedCount = typeof exportedCount === 'number' && Number.isFinite(exportedCount) && exportedCount >= 0
    ? exportedCount : (Array.isArray(metadata.ordered_variables) || typeof metadata.ordered_variables === 'string') ? ordered.length : null;
  const treatment = ['ordinal', 'mixed', 'continuous'].includes(declared) ? declared
    : (hasThresholds || ordered.length > 0 || orderedCount > 0) ? 'ordered'
      : orderedCount === 0 ? 'continuous' : 'unknown';
  const labels = { ordinal: 'Ordinal', mixed: 'Mixed', continuous: 'Continuous', ordered: 'Ordinal / mixed', unknown: 'Type unknown' };
  return {
    variantLabel: data?.label, resultData: data, metadata, ordered, orderedCount, treatment, treatmentLabel: labels[treatment], hasThresholds,
    hasPaths,
    hasDefined: parameterRows(data, 'defined').length > 0,
    supportsThresholds: hasThresholds || ['ordinal', 'mixed', 'ordered'].includes(treatment),
    estimator: settingText(metadata.estimator_requested, '') || settingText(metadata.estimator_actual, '') || settingText(metadata.estimator, ''),
    missing: settingText(metadata.missing, '')
  };
}

function sampleSizeTotal(data) {
  const rows = resultRows(data?.sample_size);
  if (!rows.length || rows.some(row => typeof row.n !== 'number' || !Number.isFinite(row.n))) return undefined;
  return rows.reduce((sum, row) => sum + row.n, 0);
}

function resultViewsFor(summary) {
  return RESULT_VIEWS.filter(([key]) => cfaViewAvailable(summary?.resultData,key) && (key !== 'thresholds' || summary?.supportsThresholds) && (key !== 'defined' || summary?.hasDefined) && (key !== 'paths' || summary?.hasPaths));
}

function keyModelSettings(data) {
  const summary = getMethodSummary(data);
  const m = summary.metadata;
  return [
    { argument: 'model (R object name)', value: 'Not exported; specification below' },
    { argument: 'data (R object name)', value: 'Not exported' },
    { argument: 'estimator (requested)', value: settingText(m.estimator_requested) },
    { argument: 'estimator (actual)', value: settingText(m.estimator_actual ?? m.estimator) },
    { argument: 'data treatment', value: summary.treatmentLabel },
    { argument: 'ordered (resolved)', value: summary.orderedCount !== null
      ? summary.orderedCount + ' ordered variable(s)' : summary.supportsThresholds ? 'Ordered variables present; count not exported' : 'Not exported' },
    { argument: 'missing', value: settingText(m.missing) },
    { argument: 'std.lv', value: settingText(m.std_lv) },
    { argument: 'auto.cov.lv.x', value: settingText(m.auto_cov_lv_x) },
    { argument: 'auto.cov.y', value: settingText(m.auto_cov_y) },
    { argument: 'meanstructure', value: settingText(m.meanstructure) },
    { argument: 'fixed.x', value: settingText(m.fixed_x) },
    { argument: 'parameterization', value: settingText(m.parameterization) },
    { argument: 'SE method', value: settingText(m.se_method) },
    { argument: 'test', value: settingText(m.test) }
  ];
}

function ModelFooter({ title, summary }) {
  const method = summary ?? getMethodSummary(null);
  const cue = [method.variantLabel || method.estimator || 'Estimator unknown', method.treatmentLabel, method.missing].filter(Boolean).join(' · ');
  return <div className="model-footer">
    <div className="model-title">{title}</div>
    <div className="model-method-cue" title={cue}>{cue}</div>
  </div>;
}

function KeyModelSettings({ data }) {
  const summary = getMethodSummary(data);
  return <section className="key-model-settings">
    <h3>Key model settings</h3>
    <p className="method-help">Resolved settings from the fitted model. Original R object names and the literal ordered argument are not exported.</p>
    <DataTable rows={keyModelSettings(data)} preferredColumns={['argument', 'value']} />
    {summary.ordered.length > 0 && <details className="ordered-variable-list">
      <summary>Ordered variables ({summary.ordered.length})</summary>
      <p>{summary.ordered.join(', ')}</p>
    </details>}
  </section>;
}

function ThresholdResults({ data }) {
  const rows = parameterRows(data, 'threshold');
  if (!rows.length) {
    const summary = getMethodSummary(data);
    return <p className="empty-message">{summary.treatment === 'continuous'
      ? 'Thresholds do not apply to this continuous model.'
      : 'No threshold estimates were exported for this model.'}</p>;
  }
  return <DataTable rows={rows} preferredColumns={[
    'group', 'lhs', 'op', 'rhs', 'est', 'se', 'z', 'pvalue', 'ci.lower', 'ci.upper', 'std.lv', 'std.all'
  ]} />;
}
const NOTE_LIMITS = { minWidth: 180, minHeight: 110, maxWidth: 800, maxHeight: 600 };
const MODEL_LIMITS = { minWidth: 200, minHeight: 140, maxWidth: 1000, maxHeight: 900 };
const COLLAPSED_NOTE = { width: 240, height: 64 };

function boundedSize(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function modelDimensions(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  return {
    width: boundedSize(value.width, 320, MODEL_LIMITS.minWidth, MODEL_LIMITS.maxWidth),
    height: boundedSize(value.height, 260, MODEL_LIMITS.minHeight, MODEL_LIMITS.maxHeight)
  };
}

function expandedNoteSize(node) {
  const source = node.data?.collapsed ? node.data.expandedSize ?? {} : node;
  return {
    width: boundedSize(source.width, 260, NOTE_LIMITS.minWidth, NOTE_LIMITS.maxWidth),
    height: boundedSize(source.height, 180, NOTE_LIMITS.minHeight, NOTE_LIMITS.maxHeight)
  };
}

function setNoteCollapsed(node, collapsed) {
  if (node.type !== 'note') return node;
  const expandedSize = expandedNoteSize(node);
  const size = collapsed ? COLLAPSED_NOTE : expandedSize;
  return { ...node, ...size, style: { ...node.style, ...size },
    data: { ...node.data, collapsed, expandedSize } };
}

// Store only simple formatting. Pasted/imported markup cannot introduce
// scripts, event handlers, links, images, or external content.
function cleanNoteHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  const template = document.createElement('template');
  template.innerHTML = html;
  const allowed = new Set(['P', 'DIV', 'BR', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'FONT']);
  const forbidden = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'IMG', 'VIDEO', 'AUDIO', 'LINK', 'META']);
  function cleanChildren(parent) {
    for (const child of [...parent.childNodes]) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1 || forbidden.has(child.tagName)) { child.remove(); continue; }
      cleanChildren(child);
      if (!allowed.has(child.tagName)) { child.replaceWith(...child.childNodes); continue; }
      const styles = {};
      for (const property of ['color', 'background-color', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align']) {
        const value = child.style.getPropertyValue(property);
        if (value && !/url\s*\(|var\s*\(|expression/i.test(value)) styles[property] = value;
      }
      const fontColor = child.tagName === 'FONT' ? child.getAttribute('color') : null;
      const fontSize = child.tagName === 'FONT' ? child.getAttribute('size') : null;
      const textBox = child.classList.contains('note-text-box');
      for (const attribute of [...child.attributes]) child.removeAttribute(attribute.name);
      for (const [property, value] of Object.entries(styles)) child.style.setProperty(property, value);
      if (fontColor && CSS.supports('color', fontColor)) child.setAttribute('color', fontColor);
      if (fontSize && /^[1-7]$/.test(fontSize)) child.setAttribute('size', fontSize);
      if (textBox) child.className = 'note-text-box';
    }
  }
  cleanChildren(template.content);
  if (!template.content.textContent.replace(/[\s\u200b\u00a0]/g, '')) return '';
  return template.innerHTML;
}

function NotePreviewButton({ html, children, onClick, ...props }) {
  const [position,setPosition]=useState(null),id=useId();
  const show=event=>{
    const rect=event.currentTarget.getBoundingClientRect(),width=Math.min(360,window.innerWidth-24),height=Math.min(260,window.innerHeight-24);
    setPosition({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:rect.bottom+height+12<window.innerHeight?rect.bottom+8:Math.max(12,rect.top-height-8),width,maxHeight:height});
  };
  useEffect(()=>{
    if(!position)return;
    const hide=()=>setPosition(null),key=event=>{if(event.key==='Escape')hide();};
    window.addEventListener('resize',hide);window.addEventListener('scroll',hide,true);window.addEventListener('blur',hide);document.addEventListener('keydown',key);
    return()=>{window.removeEventListener('resize',hide);window.removeEventListener('scroll',hide,true);window.removeEventListener('blur',hide);document.removeEventListener('keydown',key);};
  },[position]);
  return <><button {...props} aria-describedby={position?id:undefined} onPointerEnter={show} onPointerLeave={()=>setPosition(null)} onFocus={show} onBlur={()=>setPosition(null)}
    onClick={event=>{setPosition(null);onClick?.(event);}}>{children}</button>
    {position&&createPortal(<div id={id} role="tooltip" className="note-hover-preview" style={position}>
      <div className="note-hover-content" dangerouslySetInnerHTML={{__html:cleanNoteHtml(html)}} />
      <small>Click the note icon to open and edit.</small>
    </div>,document.body)}</>;
}

function ModelNoteButton({ data }) {
  if (!data.noteHtml) return null;
  return <NotePreviewButton html={data.noteHtml} type="button" className="model-note-icon nodrag nopan"
    aria-label={'Open notes for ' + (data.activeTitle ?? data.title)}
    onClick={event => { event.stopPropagation(); data.onOpenNotes?.(); }}>
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path d="M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  </NotePreviewButton>;
}

function RichModelNotes({ value, onChange, label = 'Model notes', placeholder = 'Write notes for this model…' }) {
  const editorRef = useRef(null);
  const initialized = useRef(false);
  const selectionRef = useRef(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!initialized.current && editorRef.current) {
      editorRef.current.innerHTML = cleanNoteHtml(value);
      initialized.current = true;
    }
  }, [value]);

  function rememberSelection() {
    const selection = window.getSelection();
    if (selection?.rangeCount && editorRef.current?.contains(selection.anchorNode) && editorRef.current?.contains(selection.focusNode)) {
      selectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    const editor = editorRef.current;
    editor.focus();
    const selection = window.getSelection();
    const saved = selectionRef.current;
    const range = saved && editor.contains(saved.commonAncestorContainer) ? saved : document.createRange();
    if (range !== saved) { range.selectNodeContents(editor); range.collapse(false); }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function publish() {
    onChange(cleanNoteHtml(editorRef.current.innerHTML));
    rememberSelection();
  }

  function format(command, value = null) {
    restoreSelection();
    if (typeof document.execCommand !== 'function') {
      setMessage('This browser supports text editing but not these formatting controls. Use Chrome or Edge for formatting.');
      return;
    }
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(command, false, value);
    publish();
  }

  function paste(event) {
    event.preventDefault();
    rememberSelection();
    const html = event.clipboardData.getData('text/html');
    if (html) format('insertHTML', cleanNoteHtml(html));
    else format('insertText', event.clipboardData.getData('text/plain'));
  }

  return <div className="model-notes-panel" onKeyDown={event => event.stopPropagation()}>
    <div className="notes-format-toolbar" role="toolbar" aria-label="Note formatting">
      {[
        ['bold', 'Bold', 'B'], ['italic', 'Italic', 'I'], ['strikeThrough', 'Strikethrough', 'S̶'],
        ['underline', 'Underline', 'U'], ['insertUnorderedList', 'Bulleted list', '• List'],
        ['insertOrderedList', 'Numbered list', '1. List']
      ].map(([command, label, text]) => <button key={command} type="button" title={label} aria-label={label}
        onMouseDown={event => event.preventDefault()} onClick={() => format(command)}>{text}</button>)}
      <label>Size <select aria-label="Note font size" defaultValue="" onMouseDown={rememberSelection}
        onChange={event => format('fontSize', event.target.value)}>
        <option value="" disabled>Font size</option>
        {[[1,10],[2,13],[3,16],[4,18],[5,24],[6,32],[7,48]].map(([value, pixels]) => <option key={value} value={value}>{pixels}px</option>)}
      </select></label>
      <label>Text <input type="color" aria-label="Note text color" defaultValue="#263341"
        onMouseDown={rememberSelection} onChange={event => format('foreColor', event.target.value)} /></label>
      <label>Highlight <input type="color" aria-label="Note background color" defaultValue="#fff2a8"
        onMouseDown={rememberSelection} onChange={event => format('hiliteColor', event.target.value)} /></label>
      <button type="button" onMouseDown={event => event.preventDefault()}
        onClick={() => format('insertHTML', '<div class="note-text-box">Text box</div><p><br></p>')}>Text box</button>
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => format('removeFormat')}>Clear formatting</button>
    </div>
    {message && <p className="method-help" role="status">{message}</p>}
    <div ref={editorRef} className="model-note-editor nodrag nopan nowheel" contentEditable suppressContentEditableWarning
      role="textbox" aria-label={label} aria-multiline="true" data-placeholder={placeholder}
      onInput={publish} onMouseUp={rememberSelection} onKeyUp={rememberSelection}
      onBlur={rememberSelection} onPaste={paste} onDrop={event => event.preventDefault()} />
    <p className="notes-save-hint">Saved on this page as you type. Use Save workspace to keep notes in your workspace file.</p>
  </div>;
}
function ModelNode({ data, selected }) {
  return (
    <div className={"model-node method-" + (data.methodSummary?.treatment ?? "unknown")}>
      <NodeResizer isVisible={selected} {...MODEL_LIMITS} handleStyle={{ width: 12, height: 12 }} />
      <ModelNoteButton data={data} />
      <ConnectionHandles />

      <img
        src={`${BASE}${data.image}`}
        alt={data.title}
        draggable={false}
      />

      <ModelFooter title={data.title} summary={data.methodSummary} />
    </div>
  );
}

// ======================================================
// Editable note node
// ======================================================

function NoteNode({ id, data, selected }) {
  const { updateNodeData, setNodes } = useReactFlow();

  return (
    <div className={"note-node" + (data.collapsed ? " note-collapsed" : "")}>
      <NodeResizer
        isVisible={selected && !data.collapsed}
        {...NOTE_LIMITS}
        handleStyle={{
          width: 14,
          height: 14
        }}
      />

      <ConnectionHandles />
      <button className="note-toggle nodrag nopan" title={data.collapsed ? 'Expand note' : 'Collapse note'}
        aria-label={data.collapsed ? 'Expand note' : 'Collapse note'}
        onClick={() => setNodes(current => current.map(node => node.id === id ? setNoteCollapsed(node, !node.data.collapsed) : node))}>
        {data.collapsed ? '▸' : '▾'}
      </button>

      <input
        className="note-title nodrag"
        value={data.title ?? ''}
        placeholder="Heading"
        onChange={event =>
          updateNodeData(id, {
            title: event.target.value
          })
        }
      />

      {!data.collapsed && <textarea
        className="note-text nodrag nowheel"
        value={data.text ?? ''}
        placeholder="Type here..."
        onChange={event =>
          updateNodeData(id, {
            text: event.target.value
          })
        }
      />}
    </div>
  );
}

// Stack nodes own canvas geometry; model nodes retain individual results identity.
// Verify catalog entries against their actual files, not cached images or the
// catalog alone. Only definite absence removes an entry; errors abort refresh.
async function modelFileExists(filePath, kind) {
  const options = { cache: 'no-store', signal: AbortSignal.timeout(15000) };
  let response = await fetch(BASE + filePath, {
    ...options, method: kind === 'image' ? 'HEAD' : 'GET'
  });
  if (kind === 'image' && (response.status === 405 || response.status === 501)) {
    response = await fetch(BASE + filePath, options);
  }
  if (response.status === 404 || response.status === 410) return false;
  if (!response.ok) {
    throw new Error('Could not verify ' + filePath + ' (' + response.status + '). Library unchanged.');
  }
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  // Some development/static servers return index.html with HTTP 200 for a
  // missing asset. That is not a valid model image or result file.
  if (contentType.includes('text/html')) return false;
  if (kind === 'results') {
    try {
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid result');
      return {...getMethodSummary(selectResult(data)), variants:variantsOf(data).map(v=>({id:v.id,label:v.label,summary:getMethodSummary(v)})), defaultVariant:data.default_variant};
    } catch {
      throw new Error('Could not read ' + filePath + ' as result JSON. Library unchanged; retry after the file finishes writing.');
    }
  }
  return true;
}

async function verifyModelFiles(models) {
  const valid = new Array(models.length);
  const summaries = new Array(models.length);
  const broken = [];
  let next = 0;
  // Limit parallel requests when the library contains many models.
  await Promise.all(Array.from({ length: Math.min(4, models.length) }, async () => {
    while (next < models.length) {
      const index = next++;
      const model = models[index];
      const [imageExists, resultsExist] = await Promise.all([
        modelFileExists(model.image, 'image'),
        modelFileExists(model.results, 'results')
      ]);
      valid[index] = Boolean(imageExists && resultsExist);
      if(!valid[index])broken.push({id:model.id,title:model.title,image:Boolean(imageExists),results:Boolean(resultsExist),
        imageFiles:imageExists?[decodeURIComponent(model.image.split('/').pop())]:[],
        resultFiles:resultsExist?[decodeURIComponent(model.results.split('/').pop())]:[],
        reason:'A file became unavailable during refresh. Restore the missing file, then refresh again.'});
      summaries[index] = resultsExist || null;
    }
  }));
  return {
    broken,
    models: models.flatMap((model, index) => valid[index] ? [{ ...model, methodSummary: summaries[index] }] : []),
    missing: models.filter((_, index) => !valid[index]).map(model => model.id)
  };
}

function reconcileModelLibrary(current, catalog, makeNode, savedLayout = {}) {
  const byId = new Map(catalog.map(model => [model.id, model]));
  const existingIds = new Set(current.map(node => node.id));
  const updated = current.flatMap(node => {
    if (node.type === 'note' || isDecoration(node)) return [node];
    if (node.type === 'stack') {
      const members = node.data.memberIds.filter(id => byId.has(id));
      if (!members.length) return [];
      return [{ ...node, data: { ...node.data, memberIds: members,
        activeId: members.includes(node.data.activeId) ? node.data.activeId : members[0] } }];
    }
    const model = byId.get(node.id);
    if (!model) return [];
    return [{ ...node, data: { ...node.data,
      title: model.title || model.id, image: model.image, results: model.results, methodSummary: model.methodSummary } }];
  });
  const added = catalog.filter(model => !existingIds.has(model.id)).map(model => {
    const node = makeNode(model), position = savedLayout.model_positions?.[model.id];
    return { ...node, ...modelDimensions(savedLayout.model_sizes?.[model.id]),
      position: position ?? node.position,
      hidden: Boolean(savedLayout.used_models?.includes(model.id) && savedLayout.hidden_models?.includes(model.id)),
      data: { ...node.data, hasPosition: Boolean(position), inUse: Boolean(savedLayout.used_models?.includes(model.id)),
        noteHtml: cleanNoteHtml(savedLayout.model_notes?.[model.id]) } };
  });
  const reconciled = [...updated, ...added];
  if (!Array.isArray(savedLayout.stacks)) return reconciled;
  return [...restoreStacks(reconciled.filter(node=>node.type==='model'), savedLayout.stacks),
    ...reconciled.filter(node=>node.type!=='model' && node.type!=='stack')];
}

function libraryRefreshMessage(catalog) {
  return 'Library checked: ' + catalog.models.length + ' model(s) with both files. ' +
    (catalog.broken?.length ? catalog.broken.length + ' item(s) in Broken. ' : '') +
    (catalog.warnings??[]).join(' ') +
    (catalog.mode==='build' ? ' This is a built library snapshot; rebuild the site to include folder changes.' : '');
}

function restoreStacks(modelNodes, savedStacks = []) {
  const models = modelNodes.map(node => ({ ...node, data: { ...node.data, stackId: null } }));
  const byId = new Map(models.map(node => [node.id, node]));
  const claimed = new Set();
  const stackNodes = [];
  for (const saved of Array.isArray(savedStacks) ? savedStacks : []) {
    if (!saved || typeof saved.id !== 'string' || byId.has(saved.id) ||
        stackNodes.some(node => node.id === saved.id)) continue;
    const members = [...new Set(Array.isArray(saved.members) ? saved.members : [])]
      .filter(id => byId.has(id) && !claimed.has(id));
    if (!members.length) continue;
    for (const id of members) {
      claimed.add(id);
      const model = byId.get(id);
      model.data = { ...model.data, stackId: saved.id, inUse: false };
      model.hidden = false;
      model.selected = false;
    }
    stackNodes.push({
      id: saved.id, type: 'stack', deletable: false, ...modelDimensions(saved),
      position: saved.position ?? { x: 100, y: 100 },
      hidden: Boolean(saved.in_use && saved.hidden),
      data: {
        title: saved.title || 'Version stack', memberIds: members,
        activeId: members.includes(saved.active_model) ? saved.active_model : members[0],
        inUse: Boolean(saved.in_use), hasPosition: saved.has_position !== false
      }
    });
  }
  return [...models, ...stackNodes];
}

function remapStackEdges(edges, replacements) {
  const seen = new Set();
  return edges.flatMap(edge => {
    const source = replacements.get(edge.source) ?? edge.source;
    const target = replacements.get(edge.target) ?? edge.target;
    if (source === target && edge.source !== edge.target) return [];
    const key = JSON.stringify([source, target, edge.sourceHandle, edge.targetHandle]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...edge, source, target, selected: false }];
  });
}

function groupVersionModels(nodes, edges, memberIds, targetId, title, anchorId, newId) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const selected = [...new Set(memberIds)].filter(id => byId.get(id)?.type === 'model');
  const target = byId.get(targetId);
  if (targetId && target?.type !== 'stack') throw new Error('Choose an existing stack.');
  if ((!target && selected.length < 2) || !selected.length) {
    throw new Error('Select at least two models for a new stack.');
  }
  const anchorModel = byId.get(anchorId) ?? byId.get(selected[0]);
  const anchor = byId.get(anchorModel.data.stackId) ?? anchorModel;
  const destinationId = target?.id ?? newId;
  const members = [...new Set([...(target?.data.memberIds ?? []), ...selected])];
  const replacements = new Map(selected.map(id => [id, destinationId]));
  const chosen = new Set(selected);
  let updated = nodes.flatMap(node => {
    if (node.id === destinationId) return [];
    if (node.type === 'stack') {
      const remaining = node.data.memberIds.filter(id => !chosen.has(id));
      if (!remaining.length) {
        replacements.set(node.id, destinationId);
        return [];
      }
      return [{ ...node, data: { ...node.data, memberIds: remaining,
        activeId: remaining.includes(node.data.activeId) ? node.data.activeId : remaining[0] } }];
    }
    if (!chosen.has(node.id)) return [node];
    return [{ ...node, hidden: false, selected: false,
      data: { ...node.data, stackId: destinationId, inUse: false } }];
  });
  updated.push(target ? { ...target, data: { ...target.data, memberIds: members } } : {
    id: destinationId, type: 'stack', deletable: false, ...modelDimensions(anchor),
    position: { ...anchor.position }, hidden: Boolean(anchor.hidden),
    data: { title: title.trim() || 'Version stack', memberIds: members,
      activeId: selected.includes(anchorId) ? anchorId : selected[0],
      inUse: Boolean(anchor.data.inUse), hasPosition: Boolean(anchor.data.hasPosition || anchor.data.inUse) }
  });
  return { nodes: updated, edges: remapStackEdges(edges, replacements) };
}

function splitVersionStack(nodes, edges, stackId, detachedId = null) {
  const stack = nodes.find(node => node.id === stackId && node.type === 'stack');
  if (!stack) return { nodes, edges };
  const ids = stack.data.memberIds;
  if (detachedId && !ids.includes(detachedId)) return { nodes, edges };
  const detached = detachedId ? [detachedId] : ids;
  const remaining = ids.filter(id => !detached.includes(id));
  const heir = detachedId || stack.data.activeId;
  const updated = nodes.flatMap(node => {
    if (node.id === stackId) {
      return remaining.length ? [{ ...node, data: { ...node.data, memberIds: remaining,
        activeId: remaining.includes(node.data.activeId) ? node.data.activeId : remaining[0] } }] : [];
    }
    if (!detached.includes(node.id)) return [node];
    const offset = !remaining.length && node.id === heir ? 0 : 350 + detached.indexOf(node.id) * 60;
    return [{ ...node, hidden: stack.hidden, selected: false,
      position: { x: stack.position.x + offset, y: stack.position.y + (offset ? 60 : 0) },
      data: { ...node.data, stackId: null, inUse: stack.data.inUse, hasPosition: true } }];
  });
  return { nodes: updated, edges: remaining.length ? edges
    : remapStackEdges(edges, new Map([[stackId, heir]])) };
}

function displayVersionNodes(nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  return nodes.map(node => {
    if (node.type === 'note' || isDecoration(node)) return node;
    if (node.type === 'model') return node.data.stackId || !node.data.inUse
      ? { ...node, hidden: true, selected: false } : node;
    const active = byId.get(node.data.activeId);
    return { ...node, hidden: !node.data.inUse || node.hidden,
      data: { ...node.data, image: active?.data.image, methodSummary: active?.data.methodSummary,
        activeTitle: active?.data.title ?? node.data.activeId,
        versionIndex: node.data.memberIds.indexOf(node.data.activeId) + 1 } };
  });
}

function StackNode({ data, selected }) {
  return (
    <div className={"model-node version-stack method-" + (data.methodSummary?.treatment ?? "unknown")}>
      <NodeResizer isVisible={selected} {...MODEL_LIMITS} handleStyle={{ width: 12, height: 12 }} />
      <ModelNoteButton data={data} />
      <ConnectionHandles />
      <div className="stack-caption">{data.title} <span>{data.versionIndex} of {data.memberIds.length}</span></div>
      <img src={BASE + data.image} alt={data.activeTitle} draggable={false} />
      <ModelFooter title={data.activeTitle} summary={data.methodSummary} />
    </div>
  );
}


const DECORATION_TYPES = ['shape', 'container'];
const isDecoration = node => DECORATION_TYPES.includes(node.type);
const isGroupItem = node => node.type === 'note' || (['model','stack'].includes(node.type) && node.data.inUse && !node.data.stackId);
function itemBox(node) {
  return { x: node.position.x, y: node.position.y, width: node.width ?? node.measured?.width ?? 320, height: node.height ?? node.measured?.height ?? 260 };
}
function encloses(a,b) { return b.x >= a.x - .01 && b.y >= a.y - .01 && b.x+b.width <= a.x+a.width+.01 && b.y+b.height <= a.y+a.height+.01; }
function overlaps(a,b) { return a.x < b.x+b.width-.01 && a.x+a.width > b.x+.01 && a.y < b.y+b.height-.01 && a.y+a.height > b.y+.01; }
function decorationStyle(data = {}) {
  return { fill: /^#[0-9a-f]{6}$/i.test(data.fill) ? data.fill : '#fff2b3', border: /^#[0-9a-f]{6}$/i.test(data.border) ? data.border : '#a68b32',
    thickness: boundedSize(data.thickness,2,0,12), line: ['solid','dashed','dotted'].includes(data.line) ? data.line : 'solid' };
}
function normalizeDecoration(node) {
  const type = node.type === 'container' ? 'container' : 'shape';
  const kind = type === 'container' ? 'rectangle' : ['rectangle','circle','rounded'].includes(node.data?.kind) ? node.data.kind : 'rectangle';
  const width = boundedSize(node.width,300,60,5000), height = kind === 'circle' ? width : boundedSize(node.height,200,60,5000);
  return { id: node.id, type, position: { x: Number.isFinite(node.position?.x) ? node.position.x : 0, y: Number.isFinite(node.position?.y) ? node.position.y : 0 },
    width,height, dragHandle: '.decoration-drag', data: { ...decorationStyle(node.data), kind, order: Number.isFinite(node.data?.order) ? node.data.order : 0,
      members: type === 'container' && Array.isArray(node.data?.members) ? [...new Set(node.data.members.filter(id=>typeof id==='string'))] : [] } };
}
function loadDecorations(value) { return Array.isArray(value) ? value.filter(node => node && typeof node.id === 'string' && DECORATION_TYPES.includes(node.type)).map(normalizeDecoration) : []; }
// Shrink only: keep every fully enclosed eligible item, and exclude partial or already-owned items.
function fitContainer(box, nodes, containerId) {
  const others = nodes.filter(node => node.type === 'container' && node.id !== containerId);
  const owned = new Set(others.flatMap(node => node.data.members ?? []));
  const items = nodes.filter(node => isGroupItem(node) && !node.hidden);
  const desired = items.filter(node => !owned.has(node.id) && encloses(box,itemBox(node)));
  const obstacles = items.filter(node => owned.has(node.id) || !encloses(box,itemBox(node))).map(itemBox);
  let candidates = [box];
  for (const obstacle of obstacles) {
    const next=[];
    for (const rect of candidates) {
      if (!overlaps(rect,obstacle)) { next.push(rect); continue; }
      const right=rect.x+rect.width, bottom=rect.y+rect.height;
      next.push({ ...rect,width:obstacle.x-rect.x-2 },{ ...rect,x:obstacle.x+obstacle.width+2,width:right-obstacle.x-obstacle.width-2 },
        { ...rect,height:obstacle.y-rect.y-2 },{ ...rect,y:obstacle.y+obstacle.height+2,height:bottom-obstacle.y-obstacle.height-2 });
    }
    candidates=next.filter(rect=>rect.width>=60 && rect.height>=60 && desired.every(node=>encloses(rect,itemBox(node))))
      .sort((a,b)=>b.width*b.height-a.width*a.height).slice(0,256);
    if (!candidates.length) return null;
  }
  const result=candidates.sort((a,b)=>b.width*b.height-a.width*a.height)[0];
  return { box:result,members:desired.map(node=>node.id) };
}
function maintainMembership(nodes) {
  const byId=new Map(nodes.map(node=>[node.id,node])), claimed=new Set();
  return nodes.map(node=> {
    if (node.type !== 'container') return node;
    const members=[];
    for (const id of node.data.members ?? []) {
      const original=byId.get(id), item=original?.data.stackId ? byId.get(original.data.stackId) : original;
      if (item && isGroupItem(item) && !claimed.has(item.id) && (item.id===id || encloses(itemBox(node),itemBox(item)))) { members.push(item.id); claimed.add(item.id); }
    }
    return members.length === (node.data.members??[]).length && members.every((id,i)=>id===node.data.members[i]) ? node : { ...node,data:{...node.data,members} };
  });
}
function assignItems(nodes, ids) {
  let updated=maintainMembership(nodes);
  for (const id of ids) {
    const item=updated.find(node=>node.id===id);
    if (!item || !isGroupItem(item) || item.hidden) continue;
    const containers=updated.filter(node=>node.type==='container');
    const previous=containers.find(node=>node.data.members.includes(id));
    const owner=(previous && encloses(itemBox(previous),itemBox(item)) ? previous : containers.find(node=>encloses(itemBox(node),itemBox(item))))?.id;
    updated=updated.map(node=>node.type==='container' ? { ...node,data:{...node.data,members:[...node.data.members.filter(member=>member!==id),...(node.id===owner?[id]:[])]} } : node);
  }
  return updated;
}
function DecorationNode({ data, selected, type }) {
  const container=type==='container';
  return <div className={'decoration-body '+(data.kind==='circle'?'shape-circle':data.kind==='rounded'?'shape-rounded':'')}
    style={{backgroundColor:data.fill,borderColor:data.border,borderWidth:data.thickness,borderStyle:data.line}}>
    <NodeResizer isVisible={selected} minWidth={60} minHeight={60} maxWidth={5000} maxHeight={5000} keepAspectRatio={data.kind==='circle'}
      onResizeStart={data.onResizeStart} onResizeEnd={data.onResizeEnd} />
    <div className="decoration-drag" title="Drag this badge to move">{container ? '▣ Container · '+data.members.length+(data.members.length===1?' item':' items') : '◇ Shape · '+({rectangle:'Rectangle',circle:'Circle',rounded:'Rounded rectangle'}[data.kind])}</div>
  </div>;
}

const nodeTypes = {
  shape: DecorationNode,
  container: DecorationNode,
  stack: StackNode,
  model: ModelNode,
  note: NoteNode
};


const ARROW_DEFAULTS = { color: '#64748b', thickness: 2, head: 'filled', size: 18, ends: 'end' };
function arrowAppearance(edge) {
  const value = edge.data?.appearance ?? {};
  return { color: /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : ARROW_DEFAULTS.color,
    thickness: boundedSize(value.thickness, 2, 1, 6),
    head: ['none','open','filled'].includes(value.head) ? value.head : 'filled',
    ends: ['none','start','end','both'].includes(value.ends) ? value.ends : 'end',
    size: boundedSize(value.size, 18, 8, 36) };
}
function arrowBend(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x, y: value.y } : null;
}
function arrowMarker(edge, end) {
  const style = arrowAppearance(edge);
  if (style.head === 'none' || (style.ends !== 'both' && style.ends !== end)) return undefined;
  return { type: style.head === 'open' ? MarkerType.Arrow : MarkerType.ArrowClosed,
    color: style.color, width: style.size, height: style.size, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' };
}
function routedArrow(props) {
  const bend = arrowBend(props.data?.bend);
  if (!bend) return getSmoothStepPath(props);
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = props;
  const x = (sx + tx) / 2 + bend.x, y = (sy + ty) / 2 + bend.y;
  const direction = position => ({ left: [-1,0], right: [1,0], top: [0,-1], bottom: [0,1] }[position] ?? [1,0]);
  const source = direction(props.sourcePosition), target = direction(props.targetPosition);
  const length = Math.hypot(tx - sx, ty - sy) || 1;
  const ux = (tx - sx) / length, uy = (ty - sy) / length;
  const first = Math.max(20, Math.hypot(x - sx, y - sy) / 3), last = Math.max(20, Math.hypot(tx - x, ty - y) / 3);
  return ['M ' + sx + ',' + sy + ' C ' + (sx + source[0]*first) + ',' + (sy + source[1]*first) + ' ' + (x-ux*first) + ',' + (y-uy*first) + ' ' + x + ',' + y
    + ' C ' + (x+ux*last) + ',' + (y+uy*last) + ' ' + (tx+target[0]*last) + ',' + (ty+target[1]*last) + ' ' + tx + ',' + ty, x, y];
}
function AnnotatedEdge(props) {
  const { screenToFlowPosition, setEdges, getInternalNode, getZoom } = useReactFlow();
  const dragging = useRef(false);
  const endpointDrag = useRef(null);
  const [endpointPreview, setEndpointPreview] = useState(null);
  const [path, x, y] = routedArrow(props);
  useEffect(() => {
    const cancel = event => {
      if (event.key === 'Escape') { endpointDrag.current = null; setEndpointPreview(null); }
    };
    const blur = () => { endpointDrag.current = null; setEndpointPreview(null); };
    document.addEventListener('keydown', cancel);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('keydown', cancel); window.removeEventListener('blur', blur); };
  }, []);
  function endpointAt(event) {
    const drag = endpointDrag.current;
    if (!drag) return null;
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const points = arrowSnapPoints(getInternalNode(drag.nodeId));
    return { end: drag.end, point, points, snap: snapArrowEndpoint(point, points, getZoom()) };
  }
  function startEndpoint(event) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const end = closestArrowEnd(point, { x: props.sourceX, y: props.sourceY }, { x: props.targetX, y: props.targetY });
    endpointDrag.current = { end, nodeId: end === 'source' ? props.source : props.target, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setEdges(current=>current.map(edge=>({...edge,selected:edge.id===props.id})));
  }
  function moveEndpoint(event) {
    const drag = endpointDrag.current;
    if (!drag) return;
    event.stopPropagation();
    if (Math.hypot(event.clientX-drag.x,event.clientY-drag.y) >= 4) drag.moved = true;
    if (drag.moved) setEndpointPreview(endpointAt(event));
  }
  function finishEndpoint(event, cancel = false) {
    const drag = endpointDrag.current;
    const preview = !cancel && drag?.moved ? endpointAt(event) : null;
    if (preview?.snap) setEdges(current=>current.map(edge=>edge.id===props.id ? reattachArrow(edge,drag.end,preview.snap) : edge));
    endpointDrag.current = null; setEndpointPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const previewPoint = endpointPreview?.snap ?? endpointPreview?.point;
  const previewProps = endpointPreview ? { ...props,
    [endpointPreview.end+'X']: previewPoint.x, [endpointPreview.end+'Y']: previewPoint.y,
    [endpointPreview.end+'Position']: endpointPreview.snap?.side ?? props[endpointPreview.end+'Position'] } : props;
  const visiblePath = endpointPreview ? routedArrow(previewProps)[0] : path;
  function move(point) {
    const bend = { x: point.x - (props.sourceX + props.targetX) / 2, y: point.y - (props.sourceY + props.targetY) / 2 };
    setEdges(current => current.map(edge => edge.id === props.id ? { ...edge, data: { ...edge.data, bend } } : edge));
  }
  return <>
    <BaseEdge id={props.id} path={visiblePath} markerStart={props.markerStart} markerEnd={props.markerEnd}
      style={{...props.style,...(endpointPreview?{strokeDasharray:'6 4',opacity:0.7}:{})}} interactionWidth={0} />
    <path d={visiblePath} fill="none" stroke="transparent" strokeWidth={24} className="arrow-endpoint-drag nodrag nopan"
      onPointerDown={startEndpoint} onPointerMove={moveEndpoint} onPointerUp={event=>finishEndpoint(event)}
      onPointerCancel={event=>finishEndpoint(event,true)} onLostPointerCapture={()=>{endpointDrag.current=null;setEndpointPreview(null);}}
      onContextMenu={event=>props.data.onMenu(event)}>
      <title>Drag near either end to move its connection on the same item. Escape cancels.</title>
    </path>
    {endpointPreview?.points.map(point=><circle key={point.side} cx={point.x} cy={point.y} r={8/getZoom()}
      className={'arrow-snap-point'+(endpointPreview.snap?.side===point.side?' active':'')} />)}
    <EdgeLabelRenderer>
      {props.selected && <button className="arrow-bend-handle nodrag nopan" aria-label="Move arrow bend" title="Drag to bend the arrow; arrow keys also move it"
        style={{ transform: 'translate(-50%, -50%) translate(' + x + 'px, ' + y + 'px)' }}
        onPointerDown={event => { if (event.button !== 0) return; event.stopPropagation(); dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (dragging.current) { event.stopPropagation(); move(screenToFlowPosition({ x: event.clientX, y: event.clientY })); } }}
        onPointerUp={event => { dragging.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { dragging.current = false; }}
        onKeyDown={event => { event.stopPropagation(); const delta = { ArrowLeft: [-10,0], ArrowRight: [10,0], ArrowUp: [0,-10], ArrowDown: [0,10] }[event.key];
          if (delta) { event.preventDefault(); move({ x: x + delta[0], y: y + delta[1] }); } }}
        onContextMenu={event => props.data.onMenu(event)}>◆</button>}
      {props.data?.noteHtml && <NotePreviewButton html={props.data.noteHtml} className="arrow-note-icon nodrag nopan" aria-label="Open arrow note"
        style={{ transform: 'translate(-50%, -50%) translate(' + x + 'px, ' + (y - (props.selected ? 30 : 0)) + 'px)' }}
        onClick={event => { event.stopPropagation(); props.data.onOpenNote(); }}
        onContextMenu={event => props.data.onMenu(event)}>▤</NotePreviewButton>}
    </EdgeLabelRenderer>
  </>;
}
const edgeTypes = { annotated: AnnotatedEdge };

const defaultEdgeOptions = {
  type: 'annotated',
  markerEnd: {
    type: MarkerType.ArrowClosed
  }
};

// ======================================================
// General table helpers
// ======================================================

function formatValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (value !== 0 && Math.abs(value) < 0.001) {
      return value.toExponential(2);
    }

    return Number(value.toFixed(3)).toString();
  }

  return String(value);
}

function DataTable({ rows, preferredColumns = null }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <p className="empty-message">
        No results available.
      </p>
    );
  }

  const availableColumns = Array.from(
    new Set(
      rows.flatMap(row => Object.keys(row))
    )
  );

  const columns = preferredColumns
    ? preferredColumns.filter(column => availableColumns.includes(column))
    : availableColumns;

  return (
    <div className="table-wrapper">
      <table className="result-table">
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map(column => (
                <td key={column}>
                  {formatValue(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ======================================================
// Single-model result viewer
// ======================================================

const RESULT_VIEWS = [
  ['overview', 'Overview'],
  ['fit', 'Fit'],
  ['paths', 'Paths'],
  ['loadings', 'Loadings'],
  ['defined', 'Defined parameters'],
  ['variances', 'Variances'],
  ['covariances', 'Covariances'],
  ['thresholds', 'Thresholds'],
  ['r2', 'R²'],
  ['mi', 'Modification indices'],
  ...CFA_VIEWS,
  ['notes', 'Notes']
];

function ModelSpecification({ syntax, title = 'Model specification' }) {
  const hasSyntax = typeof syntax === 'string' && syntax.trim().length > 0;

  return (
    <section className="model-specification" aria-label={title}>
      <h3>{title}</h3>
      {hasSyntax ? (
        <pre className="model-specification-code"><code>{syntax}</code></pre>
      ) : (
        <p className="empty-message">No model specification was included in this result file.</p>
      )}
    </section>
  );
}

function ResultContent({ data, view }) {
  if (!data) {
    return null;
  }

  data = normalizeResultData(data);
  if(CFA_VIEWS.some(([key])=>key===view))return <CfaView data={data} view={view} Table={DataTable}/>;
  const metadata = data.metadata;

  function fit(name) {
    return data.fit_measures
      ?.find(row => row.measure === name)
      ?.value;
  }

  if (view === 'overview') {
    const totalN = sampleSizeTotal(data);

    const rows = [
      { item: 'Model ID', value: metadata.model_id },
      { item: 'Model name', value: metadata.model_name },
      { item: 'Variant', value: data.label },
      { item: 'Post-estimation check', value: metadata.post_check },
      { item: 'Sampling-weight variable', value: metadata.sampling_weight_variable },
      { item: 'Estimator', value: getMethodSummary(data).estimator || undefined },
      { item: 'Data treatment', value: getMethodSummary(data).treatmentLabel },
      { item: 'N', value: totalN },
      { item: 'Parameters', value: metadata.number_parameters },
      { item: 'Groups', value: metadata.number_groups },
      { item: 'Converged', value: metadata.converged },
      { item: 'Robust CFI', value: fit('cfi.robust') },
      { item: 'Robust TLI', value: fit('tli.robust') },
      { item: 'Robust RMSEA', value: fit('rmsea.robust') },
      { item: 'SRMR', value: fit('srmr') },
      { item: 'CFI', value: fit('cfi') },
      { item: 'TLI', value: fit('tli') },
      { item: 'RMSEA', value: fit('rmsea') }
    ].filter(row => row.value !== null && row.value !== undefined);

    return (
      <>
        <DataTable
          rows={rows}
          preferredColumns={['item', 'value']}
        />
        {data.isCfaVariant&&<details><summary>Extraction diagnostics</summary><DataTable rows={Object.entries(data.diagnostics??{}).filter(([,d])=>d.status!=='ok'||d.warnings?.length).map(([section,d])=>({section,status:d.status,message:d.error||settingText(d.warnings,'')}))}/></details>}
        <KeyModelSettings data={data} />
        <ModelSpecification syntax={data.model_syntax} />
      </>
    );
  }

  if (view === 'thresholds') return <ThresholdResults data={data} />;

  if (view === 'fit') {
    return (
      <DataTable
        rows={data.fit_measures}
        preferredColumns={['measure', 'value']}
      />
    );
  }

  if (view === 'paths') {
    const rows = parameterRows(data, 'regression');

    return (
      <DataTable
        rows={rows}
        preferredColumns={[
          'group',
          'lhs',
          'op',
          'rhs',
          'est',
          'se',
          'z',
          'pvalue',
          'ci.lower',
          'ci.upper',
          'std.lv',
          'std.all'
        ]}
      />
    );
  }

  if (['loadings', 'variances', 'covariances', 'defined'].includes(view)) {
    const rows = parameterRows(data, view === 'defined' ? 'defined' : view === 'variances' ? 'variance' : view === 'covariances' ? 'covariance' : 'loading');

    return (
      <DataTable
        rows={rows}
        preferredColumns={[
          'group',
          'lhs',
          'op',
          'rhs',
          'est',
          'se',
          'z',
          'pvalue',
          'ci.lower',
          'ci.upper',
          'std.lv',
          'std.all'
        ]}
      />
    );
  }

  if (view === 'r2') {
    return (
      <DataTable
        rows={data.r_squared ?? []}
        preferredColumns={['group', 'variable', 'r2']}
      />
    );
  }

  if (view === 'mi') {
    return (
      <DataTable
        rows={data.modification_indices ?? []}
        preferredColumns={[
          'group',
          'lhs',
          'op',
          'rhs',
          'mi',
          'epc',
          'sepc.lv',
          'sepc.all',
          'sepc.nox'
        ]}
      />
    );
  }

  return null;
}

function ResultWindow({
  windowData,
  onClose,
  onChangeView,
  onChangeVariant,
  noteHtml,
  onNotesChange
}) {
  if (!windowData) {
    return null;
  }

  const currentLabel = RESULT_VIEWS.find(
    item => item[0] === windowData.view
  )?.[1] ?? 'Results';

  const initialX = Math.max(
    20,
    window.innerWidth - 930
  );

  return (
    <Rnd
      default={{
        x: initialX,
        y: 70,
        width: 900,
        height: 650
      }}
      minWidth={450}
      minHeight={300}
      bounds="window"
      dragHandleClassName="result-window-dragbar"
      enableResizing={{
        top: false,
        right: false,
        bottom: false,
        left: false,
        topRight: false,
        topLeft: false,
        bottomRight: true,
        bottomLeft: true
      }}
      resizeHandleStyles={{
        bottomRight: {
          width: '20px',
          height: '20px',
          right: '3px',
          bottom: '3px',
          borderRight: '3px solid #999',
          borderBottom: '3px solid #999',
          cursor: 'nwse-resize'
        },
        bottomLeft: {
          width: '20px',
          height: '20px',
          left: '3px',
          bottom: '3px',
          borderLeft: '3px solid #999',
          borderBottom: '3px solid #999',
          cursor: 'nesw-resize'
        }
      }}
      className="result-window"
    >
      <div className="result-window-header">
        <div className="result-window-dragbar">
          <div className="result-model-name">
            {windowData.title}
          </div>

          <div className="result-section-name">
            {currentLabel}
          </div>
        </div>

        <button
          className="result-close"
          onClick={onClose}
          title="Close"
        >
          ×
        </button>
      </div>

      {windowData.variants?.length>1&&<label className="cfa-variant-selector">Estimation variant <select value={windowData.variantId} onChange={e=>onChangeVariant(e.target.value)}>{windowData.variants.map(v=><option key={v.id} value={v.id}>{v.label||v.id}</option>)}</select></label>}
      <div className="result-tabs">
        {resultViewsFor(getMethodSummary(windowData.data)).map(([key, label]) => (
          <button
            key={key}
            className={(windowData.view === key ? 'active ' : '') + (key === 'defined' ? 'defined-tab' : '')}
            onClick={() => onChangeView(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={"result-window-body" + (windowData.view === 'notes' ? ' notes-window-body' : '')}>
        {windowData.view === 'notes' ? (
          <RichModelNotes key={windowData.nodeId} value={noteHtml} onChange={onNotesChange} />
        ) : windowData.loading ? (
          <p>Loading...</p>
        ) : windowData.error ? (
          <p className="error-message">
            {windowData.error}
          </p>
        ) : (
          <ResultContent
            data={windowData.data}
            view={windowData.view}
          />
        )}
      </div>
    </Rnd>
  );
}

// ======================================================
// Comparison helpers
// ======================================================

const COMPARISON_VIEWS = [
  ['overview', 'Overview'],
  ['fit', 'Fit'],
  ['paths', 'Paths'],
  ['loadings', 'Loadings'],
  ['defined', 'Defined parameters'],
  ['variances', 'Variances'],
  ['covariances', 'Covariances'],
  ['thresholds', 'Thresholds'],
  ['r2', 'R²'],
  ['mi', 'Modification indices'],
  ...CFA_VIEWS
];

const PARAMETER_FIELDS = [
  ['est', 'Estimate'],
  ['se', 'SE'],
  ['z', 'z'],
  ['pvalue', 'p'],
  ['ci.lower', 'CI lower'],
  ['ci.upper', 'CI upper'],
  ['std.lv', 'Std.lv'],
  ['std.all', 'Std.all']
];

const MI_FIELDS = [
  ['mi', 'MI'],
  ['epc', 'EPC'],
  ['sepc.lv', 'SEPC.lv'],
  ['sepc.all', 'SEPC.all'],
  ['sepc.nox', 'SEPC.nox']
];

function modelLabel(model) {
  if(model.data?.isCfaVariant)return model.title;
  return (
    model.data?.metadata?.model_name ??
    model.title ??
    model.id
  );
}

function getFitValue(data, measure) {
  return data.fit_measures
    ?.find(row => row.measure === measure)
    ?.value;
}

function getOverviewItems(model) {
  const data = normalizeResultData(model.data);
  const metadata = data.metadata ?? {};

  const totalN = sampleSizeTotal(data);

  return {
    'Model ID': metadata.model_id,
    'Model name': metadata.model_name,
    'Estimator': getMethodSummary(data).estimator || undefined,
    'Data treatment': getMethodSummary(data).treatmentLabel,
    'N': totalN,
    'Parameters': metadata.number_parameters,
    'Groups': metadata.number_groups,
    'Converged': metadata.converged,
    'Robust CFI': getFitValue(data, 'cfi.robust'),
    'Robust TLI': getFitValue(data, 'tli.robust'),
    'Robust RMSEA': getFitValue(data, 'rmsea.robust'),
    'SRMR': getFitValue(data, 'srmr'),
    'CFI': getFitValue(data, 'cfi'),
    'TLI': getFitValue(data, 'tli'),
    'RMSEA': getFitValue(data, 'rmsea')
  };
}

function unionInOrder(arrays) {
  const seen = new Set();
  const out = [];

  arrays.flat().forEach(value => {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  });

  return out;
}

function parameterKey(row) {
  return [
    row.group ?? '',
    row.lhs ?? '',
    row.op ?? '',
    row.rhs ?? ''
  ].join('|||');
}

function r2Key(row) {
  return [
    row.group ?? '',
    row.variable ?? ''
  ].join('|||');
}

function buildAlignedRows(models, selector, keyFn) {
  const rowsByModel = models.map(model => selector(model.data ?? {}));

  const keys = unionInOrder(
    rowsByModel.map(rows => rows.map(keyFn))
  );

  const maps = rowsByModel.map(rows =>
    new Map(rows.map(row => [keyFn(row), row]))
  );

  return {
    keys,
    maps
  };
}

function CheckboxFields({
  options,
  selected,
  onChange
}) {
  function toggle(key) {
    if (selected.includes(key)) {
      if (selected.length === 1) {
        return;
      }

      onChange(selected.filter(item => item !== key));
    } else {
      onChange([...selected, key]);
    }
  }

  return (
    <div className="compare-field-picker">
      <span className="compare-control-label">
        Show:
      </span>

      {options.map(([key, label]) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={selected.includes(key)}
            onChange={() => toggle(key)}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

function GroupingToggle({ value, onChange }) {
  return (
    <div className="compare-group-toggle">
      <span className="compare-control-label">
        Columns:
      </span>

      <button
        className={value === 'model' ? 'active' : ''}
        onClick={() => onChange('model')}
      >
        Group by model
      </button>

      <button
        className={value === 'stat' ? 'active' : ''}
        onClick={() => onChange('stat')}
      >
        Group by statistic
      </button>
    </div>
  );
}

function SimpleComparisonTable({
  models,
  rowLabels,
  valueGetter,
  firstColumnLabel = 'Item'
}) {
  return (
    <div className="table-wrapper">
      <table className="result-table compare-table">
        <thead>
          <tr>
            <th>{firstColumnLabel}</th>

            {models.map(model => (
              <th key={model.id}>
                {modelLabel(model)}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rowLabels.map(label => (
            <tr key={label}>
              <td>{label}</td>

              {models.map(model => (
                <td key={model.id}>
                  {formatValue(valueGetter(model, label))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ParameterComparisonTable({
  models,
  section,
  selectedFields,
  grouping
}) {
  const { keys, maps } = buildAlignedRows(
    models,
    data => parameterRows(data, section),
    section === 'defined' ? row => String(row.lhs ?? '') : parameterKey
  );

  const fieldLabels = Object.fromEntries(PARAMETER_FIELDS);
  const methodSummaries = models.map(model => getMethodSummary(model.data));

  if (keys.length === 0) {
    return <p className="empty-message">No results available.</p>;
  }

  const identityFor = key => {
    for (const map of maps) {
      const row = map.get(key);
      if (row) return row;
    }
    return {};
  };

  return (
    <div className="table-wrapper">
      <table className="result-table compare-table compare-multilevel">
        <thead>
          <tr>
            {section !== 'defined' && <th rowSpan="2">Group</th>}
            <th rowSpan="2">lhs</th>
            {section !== 'defined' && <th rowSpan="2">op</th>}
            {section !== 'defined' && <th rowSpan="2">rhs</th>}

            {grouping === 'model'
              ? models.map(model => (
                  <th
                    key={model.id}
                    colSpan={selectedFields.length}
                    className="compare-divider-left"
                  >
                    {modelLabel(model)}
                  </th>
                ))
              : selectedFields.map(field => (
                  <th
                    key={field}
                    colSpan={models.length}
                    className="compare-divider-left"
                  >
                    {fieldLabels[field] ?? field}
                  </th>
                ))}
          </tr>

          <tr>
            {grouping === 'model'
              ? models.flatMap(model =>
                  selectedFields.map((field, index) => (
                    <th
                      key={`${model.id}-${field}`}
                      className={index === 0 ? 'compare-divider-left' : ''}
                    >
                      {fieldLabels[field] ?? field}
                    </th>
                  ))
                )
              : selectedFields.flatMap(field =>
                  models.map((model, index) => (
                    <th
                      key={`${field}-${model.id}`}
                      className={index === 0 ? 'compare-divider-left' : ''}
                    >
                      {modelLabel(model)}
                    </th>
                  ))
                )}
          </tr>
        </thead>

        <tbody>
          {keys.map(key => {
            const identity = identityFor(key);

            return (
              <tr key={key}>
                {section !== 'defined' && <td>{formatValue(identity.group)}</td>}
                <td>{formatValue(identity.lhs)}</td>
                {section !== 'defined' && <td>{formatValue(identity.op)}</td>}
                {section !== 'defined' && <td>{formatValue(identity.rhs)}</td>}

                {grouping === 'model'
                  ? models.flatMap((model, modelIndex) =>
                      selectedFields.map((field, fieldIndex) => (
                        <td
                          key={`${model.id}-${field}`}
                          className={fieldIndex === 0 ? 'compare-divider-left' : ''}
                        >
                          {section === 'threshold' && !methodSummaries[modelIndex].supportsThresholds && methodSummaries[modelIndex].treatment === 'continuous'
                            ? 'N/A' : formatValue(maps[modelIndex].get(key)?.[field])}
                        </td>
                      ))
                    )
                  : selectedFields.flatMap(field =>
                      models.map((model, modelIndex) => (
                        <td
                          key={`${field}-${model.id}`}
                          className={modelIndex === 0 ? 'compare-divider-left' : ''}
                        >
                          {section === 'threshold' && !methodSummaries[modelIndex].supportsThresholds && methodSummaries[modelIndex].treatment === 'continuous'
                            ? 'N/A' : formatValue(maps[modelIndex].get(key)?.[field])}
                        </td>
                      ))
                    )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MIComparisonTable({
  models,
  selectedFields,
  grouping
}) {
  const { keys, maps } = buildAlignedRows(
    models,
    data => data.modification_indices ?? [],
    parameterKey
  );

  const fieldLabels = Object.fromEntries(MI_FIELDS);

  if (keys.length === 0) {
    return <p className="empty-message">No results available.</p>;
  }

  const identityFor = key => {
    for (const map of maps) {
      const row = map.get(key);
      if (row) return row;
    }
    return {};
  };

  return (
    <div className="table-wrapper">
      <table className="result-table compare-table compare-multilevel">
        <thead>
          <tr>
            <th rowSpan="2">Group</th>
            <th rowSpan="2">lhs</th>
            <th rowSpan="2">op</th>
            <th rowSpan="2">rhs</th>

            {grouping === 'model'
              ? models.map(model => (
                  <th
                    key={model.id}
                    colSpan={selectedFields.length}
                    className="compare-divider-left"
                  >
                    {modelLabel(model)}
                  </th>
                ))
              : selectedFields.map(field => (
                  <th
                    key={field}
                    colSpan={models.length}
                    className="compare-divider-left"
                  >
                    {fieldLabels[field] ?? field}
                  </th>
                ))}
          </tr>

          <tr>
            {grouping === 'model'
              ? models.flatMap(model =>
                  selectedFields.map((field, index) => (
                    <th
                      key={`${model.id}-${field}`}
                      className={index === 0 ? 'compare-divider-left' : ''}
                    >
                      {fieldLabels[field] ?? field}
                    </th>
                  ))
                )
              : selectedFields.flatMap(field =>
                  models.map((model, index) => (
                    <th
                      key={`${field}-${model.id}`}
                      className={index === 0 ? 'compare-divider-left' : ''}
                    >
                      {modelLabel(model)}
                    </th>
                  ))
                )}
          </tr>
        </thead>

        <tbody>
          {keys.map(key => {
            const identity = identityFor(key);

            return (
              <tr key={key}>
                <td>{formatValue(identity.group)}</td>
                <td>{formatValue(identity.lhs)}</td>
                <td>{formatValue(identity.op)}</td>
                <td>{formatValue(identity.rhs)}</td>

                {grouping === 'model'
                  ? models.flatMap((model, modelIndex) =>
                      selectedFields.map((field, fieldIndex) => (
                        <td
                          key={`${model.id}-${field}`}
                          className={fieldIndex === 0 ? 'compare-divider-left' : ''}
                        >
                          {formatValue(maps[modelIndex].get(key)?.[field])}
                        </td>
                      ))
                    )
                  : selectedFields.flatMap(field =>
                      models.map((model, modelIndex) => (
                        <td
                          key={`${field}-${model.id}`}
                          className={modelIndex === 0 ? 'compare-divider-left' : ''}
                        >
                          {formatValue(maps[modelIndex].get(key)?.[field])}
                        </td>
                      ))
                    )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ComparisonContent({
  models,
  view,
  parameterFields,
  onParameterFieldsChange,
  miFields,
  onMiFieldsChange,
  grouping,
  onGroupingChange
}) {
  if (!models || models.length < 2) {
    return (
      <p className="empty-message">
        Select at least two models to compare.
      </p>
    );
  }

  models = models.map(model => ({ ...model, data: normalizeResultData(model.data) }));
  if(view==='reliability') {
    const rows=[...new Set(models.flatMap(m=>reliabilityRows(m.data).map(r=>r.factor)))];
    return <>{['omega','AVE'].map(field=><section key={field}><h3>{field}</h3><SimpleComparisonTable models={models} rowLabels={rows} firstColumnLabel="Factor" valueGetter={(m,f)=>reliabilityRows(m.data).find(r=>r.factor===f)?.[field]}/></section>)}</>;
  }
  if(view==='standardized')return <><p>Estimates and uncertainty are on the fully standardized (std.all) scale.</p><div className="compare-controls"><CheckboxFields options={PARAMETER_FIELDS.filter(([key])=>!key.startsWith('std.'))} selected={parameterFields} onChange={onParameterFieldsChange}/><GroupingToggle value={grouping} onChange={onGroupingChange}/></div><ParameterComparisonTable models={models} section="standardized" selectedFields={parameterFields.filter(key=>!key.startsWith('std.'))} grouping={grouping}/></>;
  if(CFA_VIEWS.some(([key])=>key===view))return <>{models.map(m=><section className="cfa-comparison-section" key={m.id}><h3>{m.title}</h3><CfaView data={m.data} view={view} Table={DataTable}/></section>)}</>;


  if (view === 'overview') {
    const overviewMaps = models.map(getOverviewItems);

    const rowLabels = unionInOrder(
      overviewMaps.map(itemMap => Object.keys(itemMap))
    );

    return (
      <>
        <SimpleComparisonTable
          models={models}
          rowLabels={rowLabels}
          valueGetter={(model, label) => {
            const index = models.findIndex(item => item.id === model.id);
            return overviewMaps[index]?.[label];
          }}
        />
        <section className="key-model-settings">
          <h3>Key model settings</h3>
          <p className="method-help">Resolved fitted-model settings; original model/data object names and the literal ordered argument are not exported.</p>
          <SimpleComparisonTable models={models} firstColumnLabel="Argument"
            rowLabels={keyModelSettings({}).map(row => row.argument)}
            valueGetter={(model, argument) => keyModelSettings(model.data).find(row => row.argument === argument)?.value} />
        </section>
        <div className="comparison-specifications">
          {models.map(model => (
            <ModelSpecification
              key={model.id}
              title={(modelLabel(model) === model.id ? model.id : modelLabel(model) + ' (' + model.id + ')') + ' — Model specification'}
              syntax={model.data?.model_syntax}
            />
          ))}
        </div>
      </>
    );
  }

  if (view === 'fit') {
    const measures = unionInOrder(
      models.map(model =>
        (model.data?.fit_measures ?? []).map(row => row.measure)
      )
    );

    return (
      <SimpleComparisonTable
        models={models}
        rowLabels={measures}
        firstColumnLabel="Measure"
        valueGetter={(model, measure) =>
          model.data?.fit_measures
            ?.find(row => row.measure === measure)
            ?.value
        }
      />
    );
  }

  if (['paths', 'loadings', 'thresholds', 'variances', 'covariances', 'defined'].includes(view)) {
    return (
      <>
        <div className="compare-controls">
          <CheckboxFields
            options={PARAMETER_FIELDS}
            selected={parameterFields}
            onChange={onParameterFieldsChange}
          />

          <GroupingToggle
            value={grouping}
            onChange={onGroupingChange}
          />
        </div>

        {view === 'thresholds' && <div className="threshold-applicability">
          {models.filter(model => parameterRows(model.data, 'threshold').length === 0).map(model => (
            <p className="empty-message" key={model.id}>{modelLabel(model)}: {getMethodSummary(model.data).treatment === 'continuous'
              ? 'Not applicable — continuous model.' : 'No threshold estimates exported.'}</p>
          ))}
        </div>}
        <ParameterComparisonTable
          models={models}
          section={view === 'paths' ? 'regression' : view === 'thresholds' ? 'threshold' : view === 'defined' ? 'defined' : view === 'variances' ? 'variance' : view === 'covariances' ? 'covariance' : 'loading'}
          selectedFields={parameterFields}
          grouping={grouping}
        />
      </>
    );
  }

  if (view === 'r2') {
    const { keys, maps } = buildAlignedRows(
      models,
      data => data.r_squared ?? [],
      r2Key
    );

    const rowObjects = keys.map(key => {
      for (const map of maps) {
        const row = map.get(key);
        if (row) return row;
      }
      return {};
    });

    return (
      <div className="table-wrapper">
        <table className="result-table compare-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Variable</th>
              {models.map(model => (
                <th key={model.id}>
                  {modelLabel(model)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {keys.map((key, index) => (
              <tr key={key}>
                <td>{formatValue(rowObjects[index].group)}</td>
                <td>{formatValue(rowObjects[index].variable)}</td>

                {models.map((model, modelIndex) => (
                  <td key={model.id}>
                    {formatValue(maps[modelIndex].get(key)?.r2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (view === 'mi') {
    return (
      <>
        <div className="compare-controls">
          <CheckboxFields
            options={MI_FIELDS}
            selected={miFields}
            onChange={onMiFieldsChange}
          />

          <GroupingToggle
            value={grouping}
            onChange={onGroupingChange}
          />
        </div>

        <MIComparisonTable
          models={models}
          selectedFields={miFields}
          grouping={grouping}
        />
      </>
    );
  }

  return null;
}

function ComparisonWindow({
  windowData,
  onClose,
  onChangeView
}) {
  const [parameterFields, setParameterFields] = useState([
    'est',
    'pvalue',
    'std.lv'
  ]);

  const [miFields, setMiFields] = useState([
    'mi',
    'epc',
    'sepc.all'
  ]);

  const [grouping, setGrouping] = useState('model');

  if (!windowData) {
    return null;
  }

  const currentLabel = COMPARISON_VIEWS.find(
    item => item[0] === windowData.view
  )?.[1] ?? 'Comparison';

  return (
    <Rnd
      default={{
        x: 40,
        y: 55,
        width: Math.min(1180, window.innerWidth - 80),
        height: Math.min(760, window.innerHeight - 100)
      }}
      minWidth={600}
      minHeight={350}
      bounds="window"
      dragHandleClassName="compare-window-dragbar"
      enableResizing={{
        top: false,
        right: false,
        bottom: false,
        left: false,
        topRight: false,
        topLeft: false,
        bottomRight: true,
        bottomLeft: true
      }}
      resizeHandleStyles={{
        bottomRight: {
          width: '20px',
          height: '20px',
          right: '3px',
          bottom: '3px',
          borderRight: '3px solid #777',
          borderBottom: '3px solid #777',
          cursor: 'nwse-resize'
        },
        bottomLeft: {
          width: '20px',
          height: '20px',
          left: '3px',
          bottom: '3px',
          borderLeft: '3px solid #777',
          borderBottom: '3px solid #777',
          cursor: 'nesw-resize'
        }
      }}
      className="comparison-window"
    >
      <div className="comparison-window-header">
        <div className="compare-window-dragbar">
          <div className="result-model-name">
            Compare models
          </div>

          <div className="result-section-name">
            {windowData.models
              ?.map(model => modelLabel(model))
              .join('  •  ')}
            {' — '}
            {currentLabel}
          </div>
        </div>

        <button
          className="result-close"
          onClick={onClose}
          title="Close"
        >
          ×
        </button>
      </div>

      <div className="result-tabs comparison-tabs">
        {COMPARISON_VIEWS.filter(([key]) => windowData.models?.some(m=>cfaViewAvailable(m.data,key)) && (key !== 'paths' || windowData.models?.some(model=>parameterRows(model.data,'regression').length>0)) && (key !== 'thresholds' || windowData.models?.some(model => getMethodSummary(model.data).supportsThresholds)) && (key !== 'defined' || windowData.models?.some(model => parameterRows(model.data, 'defined').length > 0))).map(([key, label]) => (
          <button
            key={key}
            className={(windowData.view === key ? 'active ' : '') + (key === 'defined' ? 'defined-tab' : '')}
            onClick={() => onChangeView(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="comparison-window-body">
        {windowData.loading ? (
          <p>Loading models...</p>
        ) : windowData.error ? (
          <p className="error-message">
            {windowData.error}
          </p>
        ) : (
          <ComparisonContent
            models={windowData.models}
            view={windowData.view}
            parameterFields={parameterFields}
            onParameterFieldsChange={setParameterFields}
            miFields={miFields}
            onMiFieldsChange={setMiFields}
            grouping={grouping}
            onGroupingChange={setGrouping}
          />
        )}
      </div>
    </Rnd>
  );
}

// ======================================================
// Main app
// ======================================================

let sharedCatalogPromise = null;

export default function App() { return <Workspace Canvas={PageCanvas} />; }

function PageCanvas({ pageId, pageType, initialLayout, onLayoutChange, controllerRef, findRequest, onFindResult, historyStore }) {
  const supportsModels = PAGE_TYPES[pageType].models;
  const [initialPageLayout] = useState(initialLayout);
  const publishedLayout = useRef(null);
  const retainedLayout = useRef(initialLayout);
  const [viewport, setViewport] = useState(() => validViewport(initialLayout.viewport));
  const [
    nodes,
    setNodes,
    // Changes are handled below to move container members.
  ] = useNodesState([]);

  const [
    edges,
    setEdges,
    onEdgesChange
  ] = useEdgesState([]);

  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [libraryNotice, setLibraryNotice] = useState('');
  const [brokenModels, setBrokenModels] = useState([]);
  const [refreshingLibrary, setRefreshingLibrary] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [foundLibraryId,setFoundLibraryId]=useState(null);
  const handledFind=useRef(null);
  const libraryCards=useRef(new Map());
  const [libraryOpen, setLibraryOpen] = useState(supportsModels);
  const [libraryQuery, setLibraryQuery] = useState('');
  const refreshPending = useRef(false);
  const [flowInstance, setFlowInstance] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [arrowMenu, setArrowMenu] = useState(null);
  const [arrowNoteId, setArrowNoteId] = useState(null);
  const [toolsOpen, setToolsOpen] = useState(() => {
    try { return localStorage.getItem('sem-tools-open') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    const dismiss = event => {
      if (!event.target.closest('.arrow-menu') && event.button === 0) setArrowMenu(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  function toggleTools() {
    const next = !toolsOpen; setToolsOpen(next);
    try { localStorage.setItem('sem-tools-open', String(next)); } catch { /* Storage unavailable */ }
  }
  function openArrowMenu(event, edge) {
    event.preventDefault(); event.stopPropagation(); setContextMenu(null);
    setArrowMenu({ id: edge.id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 270)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 400)) });
  }
  function updateArrow(id, change) {
    setEdges(current => current.map(edge => edge.id === id ? { ...edge, data: { ...edge.data, ...change } } : edge));
  }

  const [stackDialog, setStackDialog] = useState(null);
  const resultRequest=useRef(0);
  const [resultWindow, setResultWindow] = useState(null);

  const [matrixSettings,setMatrixSettings]=useState(initialLayout.matrix_settings??{});
  function updateMatrixSettings(key,value){setMatrixSettings(current=>{const next={...current};if(value===null)delete next[key];else next[key]=value;return next;});}
  const [variantSelections,setVariantSelections]=useState(initialLayout.model_variants??{});
  const [comparisonIds, setComparisonIds] = useState(() => Array.isArray(initialLayout.comparison_ids) ? initialLayout.comparison_ids : []);
  const [comparisonWindow, setComparisonWindow] = useState(null);
  const [queueOpen,setQueueOpen]=useState(false),[queueQuery,setQueueQuery]=useState('');
  const [queuePosition,setQueuePosition]=useState({});
  const comparisonRequest=useRef(0);

  const canvasRef = useRef(null);
  const [decorationMenu,setDecorationMenu]=useState(null);
  const [drawMode,setDrawMode]=useState(null);
  const [shapeKind,setShapeKind]=useState('rectangle');
  const [drawPreview,setDrawPreview]=useState(null);
  const drawStart=useRef(null), resizeBefore=useRef(new Map());
  const [canvasNotice,setCanvasNotice]=useState('');
  const [libraryPrefs,setLibraryPrefs]=useState(()=>{try{return JSON.parse(localStorage.getItem('sem-library-sections:'+pageId)||'{}')||{};}catch{return {};}});
  function dismissContextMenus(){setContextMenu(null);setArrowMenu(null);setDecorationMenu(null);}
  useEffect(()=>{
    const outside=event=>{
      if(!event.target.closest?.('.context-menu')){setContextMenu(null);setArrowMenu(null);setDecorationMenu(null);}
      if(!event.target.closest?.('.comparison-queue'))setQueueOpen(false);
    };
    const escape=event=>{if(event.key==='Escape'){setContextMenu(null);setArrowMenu(null);setDecorationMenu(null);setQueueOpen(false);}};
    const resize=()=>setQueueOpen(false);
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
    window.addEventListener('resize',resize);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',resize);};
  },[]);
  function updateLibraryPrefs(change) {
    setLibraryPrefs(current=>{const next={...current,...change};try{localStorage.setItem('sem-library-sections:'+pageId,JSON.stringify(next));}catch{/* unavailable */}return next;});
  }
  useEffect(()=> {
    const close=event=>{if(event.button===0 && !event.target.closest('.decoration-menu'))setDecorationMenu(null);};
    const cancel=event=>{if(event.key==='Escape'){setDrawMode(null);setDrawPreview(null);drawStart.current=null;setDecorationMenu(null);}};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',cancel);
    return ()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',cancel);};
  },[]);
  // Remove deleted/released members and transfer grouped models to their visible stack.
  useEffect(()=>{setNodes(current=>{const next=maintainMembership(current);return next.some((node,i)=>node!==current[i])?next:current;});},[nodes,setNodes]);
  function handleNodeChanges(changes) {
    setNodes(current=>{
      let next=applyNodeChanges(changes,current);
      const directlyMoved=new Set(changes.filter(change=>change.type==='position'&&change.position).map(change=>change.id));
      for(const change of changes) {
        const before=current.find(node=>node.id===change.id);
        if(change.type!=='position'||!change.position||!change.dragging||before?.type!=='container')continue;
        const dx=change.position.x-before.position.x,dy=change.position.y-before.position.y;
        next=next.map(node=>before.data.members.includes(node.id)&&!directlyMoved.has(node.id)?{...node,position:{x:node.position.x+dx,y:node.position.y+dy}}:node);
      }
      const finished=changes.filter(change=>(change.type==='position'&&change.dragging===false)||(change.type==='dimensions'&&change.resizing===false)).map(change=>change.id);
      return finished.length?assignItems(next,finished):next;
    });
  }
  function finishDecorationResize(id,params) {
    setNodes(current=>{
      const node=current.find(item=>item.id===id);if(!node)return current;
      const box={x:params.x,y:params.y,width:params.width,height:params.height};
      const fitted=node.type==='container'?fitContainer(box,current,id):{box,members:[]};
      const previous=resizeBefore.current.get(id);
      if(!fitted){setCanvasNotice('Resize rejected: no rectangle can keep the enclosed items without overlapping other items.');return previous?current.map(item=>item.id===id?previous:item):current;}
      if(node.type==='container' && (Math.abs(fitted.box.width-box.width)>.1||Math.abs(fitted.box.height-box.height)>.1))setCanvasNotice('Container boundary adjusted to exclude partial overlaps or items in another container.');
      return current.map(item=>item.id===id?{...item,position:{x:fitted.box.x,y:fitted.box.y},width:fitted.box.width,height:fitted.box.height,
        style:{...item.style,width:fitted.box.width,height:fitted.box.height},data:{...item.data,members:node.type==='container'?[...fitted.members,...item.data.members.filter(member=>current.find(n=>n.id===member)?.hidden)]:[]}}:item);
    });
  }
  function drawingBox(start,end) {
    let dx=end.x-start.x,dy=end.y-start.y;
    if(drawMode==='shape'&&shapeKind==='circle'){const size=Math.max(Math.abs(dx),Math.abs(dy));dx=(dx<0?-1:1)*size;dy=(dy<0?-1:1)*size;}
    return {x:Math.min(start.x,start.x+dx),y:Math.min(start.y,start.y+dy),width:Math.abs(dx),height:Math.abs(dy)};
  }
  function finishDrawing(event) {
    if(!drawStart.current||!flowInstance)return;
    const screen=drawingBox(drawStart.current,{x:event.clientX,y:event.clientY});drawStart.current=null;setDrawPreview(null);
    const topLeft=flowInstance.screenToFlowPosition({x:screen.x,y:screen.y}),bottomRight=flowInstance.screenToFlowPosition({x:screen.x+screen.width,y:screen.y+screen.height});
    const box={...topLeft,width:bottomRight.x-topLeft.x,height:bottomRight.y-topLeft.y};
    if(box.width<60||box.height<60){setCanvasNotice('Draw a larger area (at least 60 × 60 canvas units).');return;}
    const kind=drawMode;setDrawMode(null);
    setNodes(current=>{
      const fitted=kind==='container'?fitContainer(box,current,null):{box,members:[]};
      if(!fitted){setCanvasNotice('Container rejected: it cannot enclose these items without overlapping another item.');return current;}
      const id=kind+'-'+crypto.randomUUID();
      const node=normalizeDecoration({id,type:kind,position:{x:fitted.box.x,y:fitted.box.y},width:fitted.box.width,height:fitted.box.height,
        data:{kind:kind==='container'?'rectangle':shapeKind,members:fitted.members,order:Math.max(0,...current.filter(n=>n.type==='shape').map(n=>n.data.order??0))+1}});
      setCanvasNotice(kind==='container'?'Container added with '+fitted.members.length+' item(s).':'Shape added.');
      return [...current.map(n=>({...n,selected:false})),{...node,selected:true}];
    });
  }
  function openDecorationMenu(event,node){event.preventDefault();event.stopPropagation();setContextMenu(null);setArrowMenu(null);setDecorationMenu({id:node.id,x:Math.max(8,Math.min(event.clientX,window.innerWidth-275)),y:Math.max(8,Math.min(event.clientY,window.innerHeight-480))});}
  function updateDecoration(change){setNodes(current=>current.map(node=>node.id===decorationMenu?.id?{...node,data:{...node.data,...change}}:node));}
  function orderShape(action) {
    setNodes(current=>{
      const ordered=current.filter(node=>node.type==='shape').sort((a,b)=>(a.data.order??0)-(b.data.order??0));
      const index=ordered.findIndex(node=>node.id===decorationMenu?.id);if(index<0)return current;
      const target=action==='front'?ordered.length-1:action==='back'?0:Math.max(0,Math.min(ordered.length-1,index+(action==='forward'?1:-1)));
      const [item]=ordered.splice(index,1);ordered.splice(target,0,item);const ranks=new Map(ordered.map((node,i)=>[node.id,i]));
      return current.map(node=>ranks.has(node.id)?{...node,data:{...node.data,order:ranks.get(node.id)}}:node);
    });
  }


  // ====================================================
  // Older layout compatibility
  // ====================================================

  function getModelPositions(layout) {
    if (!layout) {
      return {};
    }

    if (layout.model_positions) {
      return layout.model_positions;
    }

    if (layout.positions) {
      return layout.positions;
    }

    if (!layout.schema_version) {
      return layout;
    }

    return {};
  }

  // ====================================================
  // Normalize loaded note
  // ====================================================

  function normalizeNote(note) {
    const normalized = {
      id: note.id ?? `note-${Date.now()}`,
      type: 'note',
      position: note.position ?? {
        x: 200,
        y: 200
      },
      width: boundedSize(note.width, 260, NOTE_LIMITS.minWidth, NOTE_LIMITS.maxWidth),
      height: boundedSize(note.height, 180, NOTE_LIMITS.minHeight, NOTE_LIMITS.maxHeight),
      data: {
        title: note.data?.title ?? 'Finding',
        text: note.data?.text ?? '',
        collapsed: note.data?.collapsed === true,
        expandedSize: note.data?.expandedSize
      }
    };
    return setNoteCollapsed(normalized, normalized.data.collapsed);
  }

  // ====================================================
  // Current canvas and model library → layout.json
  // ====================================================

  function getCurrentLayout() {
    const modelPositions = {};
    const notes = [];
    const hiddenModels = [];
    const usedModels = [];
    const stacks = [];
    const modelSizes = {};
    const modelNotes = {};

    const round = value =>
      Math.round(value * 100) / 100;

    nodes.forEach(node => {
      const position = {
        x: round(node.position.x),
        y: round(node.position.y)
      };

      if (node.type === 'model') {
        modelSizes[node.id] = modelDimensions(node);
        if (node.data.noteHtml) modelNotes[node.id] = node.data.noteHtml;
        if (node.data.hasPosition || node.data.inUse) {
          modelPositions[node.id] = position;
        }

        if (node.data.inUse) {
          usedModels.push(node.id);
        }

        if (node.data.inUse && node.hidden) {
          hiddenModels.push(node.id);
        }
      }

      if (node.type === 'stack') {
        stacks.push({ id: node.id, title: node.data.title, members: node.data.memberIds,
          active_model: node.data.activeId, position, ...modelDimensions(node),
          in_use: node.data.inUse, hidden: Boolean(node.hidden), has_position: node.data.hasPosition });
      }

      if (node.type === 'note') {
        const width =
          node.width ??
          node.measured?.width ??
          230;

        const height =
          node.height ??
          node.measured?.height ??
          150;

        notes.push({
          id: node.id,
          type: 'note',
          position,
          width: round(width),
          height: round(height),
          data: {
            title: node.data.title ?? '',
            text: node.data.text ?? '',
            collapsed: node.data.collapsed === true,
            expandedSize: expandedNoteSize(node)
          }
        });
      }
    });

    const savedEdges = edges.map(edge => {
      const saved = {
        type: 'annotated',
        data: { appearance: arrowAppearance(edge), bend: arrowBend(edge.data?.bend), noteHtml: cleanNoteHtml(edge.data?.noteHtml) },
        id: edge.id,
        source: edge.source,
        target: edge.target
      };

      if (edge.sourceHandle) {
        saved.sourceHandle = edge.sourceHandle;
      }

      if (edge.targetHandle) {
        saved.targetHandle = edge.targetHandle;
      }

      return saved;
    });

    const liveModelIds=new Set(nodes.filter(node=>node.type==='model').map(node=>node.id));
    const missingModelIds=new Set([...Object.keys(retainedLayout.current.model_positions??{}),...Object.keys(retainedLayout.current.model_notes??{}),...(retainedLayout.current.used_models??[]),...(retainedLayout.current.stacks??[]).flatMap(stack=>stack.members??[])].filter(id=>!liveModelIds.has(id)));
    for(const id of missingModelIds){
      if(retainedLayout.current.model_positions?.[id])modelPositions[id]=retainedLayout.current.model_positions[id];
      if(retainedLayout.current.model_notes?.[id])modelNotes[id]=retainedLayout.current.model_notes[id];
      if(retainedLayout.current.model_sizes?.[id])modelSizes[id]=retainedLayout.current.model_sizes[id];
      if(retainedLayout.current.used_models?.includes(id)&&!usedModels.includes(id))usedModels.push(id);
      if(retainedLayout.current.hidden_models?.includes(id)&&!hiddenModels.includes(id))hiddenModels.push(id);
    }
    const missingStackIds=new Set();
    for(const saved of retainedLayout.current.stacks??[]){
      const missing=(saved.members??[]).filter(id=>missingModelIds.has(id));if(!missing.length)continue;
      const present=stacks.find(stack=>stack.id===saved.id);
      if(present)present.members=[...new Set([...present.members,...missing])];
      else {stacks.push(saved);missingStackIds.add(saved.id);}
    }
    for(const edge of retainedLayout.current.edges??[])if((missingModelIds.has(edge.source)||missingModelIds.has(edge.target)||missingStackIds.has(edge.source)||missingStackIds.has(edge.target))&&!savedEdges.some(item=>item.id===edge.id))savedEdges.push(edge);
    const decorations=nodes.filter(isDecoration).map(node=>{
      const saved=retainedLayout.current.decorations?.find(item=>item.id===node.id);
      return normalizeDecoration({...node,data:{...node.data,members:[...new Set([...(node.data.members??[]),...(saved?.data?.members??[]).filter(id=>missingModelIds.has(id)||missingStackIds.has(id))])]}});
    });
    return {
      viewport: validViewport(flowInstance?.getViewport()) ?? viewport,
      comparison_ids: comparisonIds,
      model_variants: variantSelections,
      matrix_settings: matrixSettings,
      schema_version: '9.0',
      ...(retainedLayout.current.retained_content?{retained_content:retainedLayout.current.retained_content}:{}),
      decorations,
      model_sizes: modelSizes,
      model_notes: modelNotes,
      stacks,
      used_models: usedModels,
      model_positions: modelPositions,
      hidden_models: hiddenModels,
      notes,
      edges: savedEdges
    };
  }

  // ====================================================
  // Initial load
  // ====================================================

  // Older layouts identify existing models by their saved positions, visibility,
  // or connections. An explicit empty used_models array means none are in use.
  function getUsedModelIds(layout) {
    if (Array.isArray(layout.used_models)) {
      return new Set(layout.used_models);
    }
    return new Set([
      ...Object.keys(getModelPositions(layout)),
      ...(Array.isArray(layout.hidden_models) ? layout.hidden_models : []),
      ...(Array.isArray(layout.edges)
        ? layout.edges.flatMap(edge => [edge.source, edge.target])
        : [])
    ]);
  }

  async function fetchCatalog(force = false) {
    if (force) sharedCatalogPromise = null;
    if (!sharedCatalogPromise) sharedCatalogPromise = (async () => {
    const response = await fetch(
      BASE + 'model-library.json',
      { cache: 'no-store' }
    );
    if (!response.ok) {
      throw new Error('Could not scan the model folders (' + response.status + '). Library unchanged. Check the Vite plugin installation and restart the dev server.');
    }
    if (!(response.headers.get('content-type')||'').includes('application/json')) {
      throw new Error('Folder discovery is unavailable. Install modelLibraryPlugin.js and the updated vite.config.js, then restart the dev server.');
    }
    const catalog = await response.json();
    if (catalog.source!=='folder-scan' || !Array.isArray(catalog.models) || !Array.isArray(catalog.broken)) {
      throw new Error('The folder scanner returned an invalid library. Existing library unchanged.');
    }
    const ids = new Set();
    for (const model of catalog.models) {
      if (typeof model.id !== 'string' || !model.id.trim() ||
          typeof model.image !== 'string' || !model.image.trim() ||
          typeof model.results !== 'string' || !model.results.trim() ||
          ids.has(model.id)) {
        throw new Error('Each model needs a unique ID, an image path, and a results path.');
      }
      ids.add(model.id);
    }
    const checked = await verifyModelFiles(catalog.models);
    return { ...catalog, ...checked, broken: [...catalog.broken, ...checked.broken] };
  
    })().catch(error => { sharedCatalogPromise = null; throw error; });
    return sharedCatalogPromise;
  }

  function createModelNode(model) {
    return {
      id: model.id,
      type: 'model',
      ...modelDimensions(),
      deletable: false,
      hidden: false,
      position: { x: 100, y: 100 },
      data: {
        title: model.title || model.id,
        image: model.image,
        results: model.results,
        methodSummary: model.methodSummary ?? getMethodSummary(null),
        inUse: false,
        hasPosition: false
      }
    };
  }

  useEffect(() => {
    let cancelled = false;
    async function loadEverything() {
      setLibraryError('');
      try {
        const checkedCatalog = supportsModels ? await fetchCatalog() : {models:[],missing:[]};
        const catalog = checkedCatalog.models;
        const browserLayout = initialPageLayout;
        const fileLayout = {};
        const browserPositions = getModelPositions(browserLayout);
        const filePositions = getModelPositions(fileLayout);
        const hiddenModels = new Set(
          Array.isArray(browserLayout.hidden_models)
            ? browserLayout.hidden_models
            : (Array.isArray(fileLayout.hidden_models) ? fileLayout.hidden_models : [])
        );
        const usedModels = Array.isArray(browserLayout.used_models)
          ? getUsedModelIds(browserLayout)
          : Array.isArray(fileLayout.used_models)
            ? getUsedModelIds(fileLayout)
            : new Set([...getUsedModelIds(fileLayout), ...getUsedModelIds(browserLayout)]);

        const savedModelSizes = browserLayout.model_sizes ?? fileLayout.model_sizes ?? {};
        const savedModelNotes = browserLayout.model_notes ?? fileLayout.model_notes ?? {};
        const modelNodes = catalog.map(model => {
          const node = { ...createModelNode(model), ...modelDimensions(savedModelSizes[model.id]) };
          node.data.noteHtml = cleanNoteHtml(savedModelNotes[model.id]);
          const position = browserPositions[model.id] ?? filePositions[model.id];
          node.position = position ?? node.position;
          node.data.hasPosition = Boolean(position);
          node.data.inUse = usedModels.has(model.id);
          node.hidden = node.data.inUse && hiddenModels.has(model.id);
          return node;
        });
        const noteSource = Array.isArray(browserLayout.notes)
          ? browserLayout.notes
          : (Array.isArray(fileLayout.notes) ? fileLayout.notes : []);
        const loadedEdges = Array.isArray(browserLayout.edges)
          ? browserLayout.edges
          : (Array.isArray(fileLayout.edges) ? fileLayout.edges : []);
        if (cancelled) return;
        const savedStacks = Array.isArray(browserLayout.stacks) ? browserLayout.stacks
          : Array.isArray(browserLayout.used_models) ? [] : fileLayout.stacks;
        setNodes([...restoreStacks(modelNodes, savedStacks), ...noteSource.map(normalizeNote), ...loadDecorations(browserLayout.decorations ?? fileLayout.decorations)]);
        setEdges(loadedEdges);
        setModelsLoaded(true);
        setBrokenModels(checkedCatalog.broken??[]);
        setLibraryNotice(libraryRefreshMessage(checkedCatalog) + ((initialPageLayout.used_models??[]).some(id=>!catalog.some(model=>model.id===id)) ? ' Some saved models are unavailable; their page data is retained until the source files return.' : ''));
      } catch (error) {
        if (!cancelled) setLibraryError(error.message);
      }
    }
    loadEverything();
    return () => { cancelled = true; };
  }, [setNodes, setEdges, loadAttempt, supportsModels, initialPageLayout]);

  async function refreshLibrary() {
    if (!modelsLoaded) {
      setLoadAttempt(current => current + 1);
      return;
    }
    if (refreshPending.current) return;
    refreshPending.current = true;
    setRefreshingLibrary(true);
    setLibraryError('');
    setLibraryNotice('');
    try {
      const checkedCatalog = await fetchCatalog(true);
      const savedLayout = controllerRef.current?.snapshot() ?? getCurrentLayout();
      setNodes(current => reconcileModelLibrary(current, checkedCatalog.models, createModelNode, savedLayout));
      setEdges(current => [...current, ...(savedLayout.edges??[]).filter(saved=>!current.some(edge=>edge.id===saved.id))]);
      setBrokenModels(checkedCatalog.broken??[]);
      setLibraryNotice(libraryRefreshMessage(checkedCatalog));
    } catch (error) {
      setLibraryError(error.message);
    } finally {
      refreshPending.current = false;
      setRefreshingLibrary(false);
    }
  }

  // Remove references only after a successful catalog reconciliation. Notes,
  // remaining model positions, and connections with surviving endpoints stay.
  useEffect(() => {
    if (!modelsLoaded) return;
    const nodeIds = new Set(nodes.map(node => node.id));
    const modelIds = new Set(nodes.filter(node => node.type === 'model').map(node => node.id));
    setEdges(current => {
      const kept = current.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target));
      return kept.length === current.length ? current : kept;
    });
    setComparisonIds(current => {
      const kept = current.filter(id => modelIds.has(comparisonIdentity(id).modelId));
      return kept.length === current.length ? current : kept;
    });
    setResultWindow(current => current && !modelIds.has(current.nodeId) ? null : current);
    setComparisonWindow(current => current?.models?.some(model => !modelIds.has(comparisonIdentity(model.id).modelId)) ? null : current);
  }, [nodes, modelsLoaded, setEdges]);

  function selectVersion(stackId, modelId) {
    setNodes(current => current.map(node => node.id === stackId && node.data.memberIds?.includes(modelId)
      ? { ...node, data: { ...node.data, activeId: modelId } } : node));
  }

  function startOrganizing(modelId) {
    setContextMenu(null);
    setStackDialog({ selected: [modelId], target: '', name: 'Version stack', anchor: modelId, error: '' });
  }

  function commitStack(event) {
    event.preventDefault();
    try {
      const change = groupVersionModels(nodes, edges, stackDialog.selected, stackDialog.target,
        stackDialog.name, stackDialog.anchor, 'stack-' + crypto.randomUUID());
      setNodes(change.nodes);
      setEdges(change.edges);
      setStackDialog(null);
    } catch (error) {
      setStackDialog(current => ({ ...current, error: error.message }));
    }
  }

  function splitStack(stackId, modelId = null) {
    const change = splitVersionStack(nodes, edges, stackId, modelId);
    const released = modelId ? [modelId] : nodes.find(node=>node.id===stackId)?.data.memberIds ?? [];
    setNodes(assignItems(change.nodes,released));
    setEdges(change.edges);
    setContextMenu(null);
  }

  function moveVersion(stackId, modelId, direction) {
    setNodes(current => current.map(node => {
      if (node.id !== stackId) return node;
      const members = [...node.data.memberIds];
      const index = members.indexOf(modelId);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= members.length) return node;
      [members[index], members[next]] = [members[next], members[index]];
      return { ...node, data: { ...node.data, memberIds: members } };
    }));
  }

  function renderLibraryItem(node) {
    const isStack = node.type === 'stack';
    const active = isStack ? nodes.find(model => model.id === node.data.activeId) : node;
    return (
      <article ref={element=>{if(element)libraryCards.current.set(node.id,element);else libraryCards.current.delete(node.id);}} className={'library-card' + (isStack ? ' library-stack' : '')+(foundLibraryId===node.id?' found-content':'')} key={node.id}
        draggable={!node.data.inUse}
        onDragStart={event => {
          if (node.data.inUse) return;
          event.dataTransfer.setData('application/x-sem-model', node.id);
          event.dataTransfer.effectAllowed = 'copy';
          setContextMenu(null);
        }}>
        <div className="library-item-top">
          <img src={BASE + active?.data.image} alt="" draggable={false} />
          <div className="library-card-body">
            <strong>{node.data.title}</strong>
            <span className="library-status">{active?.data.methodSummary ? [active.data.methodSummary.estimator, active.data.methodSummary.treatmentLabel, active.data.methodSummary.missing].filter(Boolean).join(' · ') : 'Type unknown'}</span>
            <span className="library-status">{isStack ? node.data.memberIds.length + ' versions · ' : ''}
              {node.data.inUse ? (node.hidden ? 'Hidden on canvas' : 'On canvas') : 'Available to use'}</span>
            <div className="library-actions">
              <label className="usage-toggle"><input type="checkbox" checked={Boolean(node.data.inUse)}
                onChange={event => event.target.checked ? activateModel(node.id) : returnToLibrary(node.id)} />Use</label>
              {node.data.inUse && <button onClick={() => node.hidden ? showModel(node.id) : hideModel(node.id)}>
                {node.hidden ? 'Show' : 'Hide'}</button>}
              {!isStack && <button onClick={() => startOrganizing(node.id)}>Stack / move…</button>}
            </div>
          </div>
        </div>
        {isStack && <details open={query ? true : undefined}>
          <summary>Versions · {active?.data.title}</summary>
          <div className="stack-management">
            <label>Stack name<input aria-label={'Name of ' + node.data.title} value={node.data.title}
              onChange={event => {
                const title = event.target.value;
                setNodes(current => current.map(item => item.id === node.id
                  ? { ...item, data: { ...item.data, title } } : item));
              }} /></label>
            <button onClick={() => splitStack(node.id)}>Dissolve stack</button>
          </div>
          {node.data.memberIds.map((id, index) => {
            const model = nodes.find(item => item.id === id);
            if (!model) return null;
            const selected = id === node.data.activeId;
            return <div className={'stack-member' + (selected ? ' active-version' : '')} key={id}>
              <button className="version-choice" aria-pressed={selected} onClick={() => selectVersion(node.id, id)}>
                {selected ? '● ' : '○ '}{model.data.title}
              </button>
              <span className="library-status">{selected ? 'Displayed version' : 'Version ' + (index + 1)}
                {comparisonIds.includes(id) ? ' · In comparison' : ''}</span>
              <div className="library-actions">
                <button onClick={() => splitStack(node.id, id)}>Detach</button>
                <button onClick={() => startOrganizing(id)}>Move…</button>
                <button aria-label={'Move ' + model.data.title + ' up'} disabled={index === 0}
                  onClick={() => moveVersion(node.id, id, -1)}>↑</button>
                <button aria-label={'Move ' + model.data.title + ' down'} disabled={index === node.data.memberIds.length - 1}
                  onClick={() => moveVersion(node.id, id, 1)}>↓</button>
              </div>
            </div>;
          })}
        </details>}
      </article>
    );
  }


  function activateModel(nodeId, dropPosition) {
    let center = { x: 100, y: 100 };
    if (flowInstance && canvasRef.current) {
      const bounds = canvasRef.current.getBoundingClientRect();
      center = flowInstance.screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2
      });
      center = { x: center.x - 150, y: center.y - 100 };
    }
    setNodes(current => current.map(node => {
      if (node.id !== nodeId || node.type === 'note' || node.data.stackId || node.data.inUse) return node;
      return {
        ...node,
        hidden: false,
        position: dropPosition ?? (node.data.hasPosition ? node.position : center),
        data: { ...node.data, inUse: true, hasPosition: true }
      };
    }));
    setContextMenu(null);
  }

  function returnToLibrary(nodeId) {
    setNodes(current => current.map(node =>
      node.id === nodeId && node.type !== 'note' && !node.data.stackId
        ? {
            ...node,
            hidden: false,
            selected: false,
            data: { ...node.data, inUse: false, hasPosition: true }
          }
        : node
    ));
    setComparisonIds(current => current.filter(id => comparisonIdentity(id).modelId !== nodeId));
    setContextMenu(null);
  }

  function showModel(nodeId) {
    setNodes(current => current.map(node =>
      node.id === nodeId && node.type !== 'note' && !node.data.stackId && node.data.inUse
        ? { ...node, hidden: false }
        : node
    ));
  }

  function onLibraryDrop(event) {
    const nodeId = event.dataTransfer.getData('application/x-sem-model');
    if (!supportsModels || !nodeId || !flowInstance) return;
    event.preventDefault();
    activateModel(nodeId, flowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY
    }));
  }

  // ====================================================
  // Publish this page only; the workspace owns storage and file operations.
  // A keyed PageCanvas unmounts when switching pages, isolating async requests.
  function restoreHistory(document) {
    retainedLayout.current = document;
    setVariantSelections(document.model_variants??{});
    setMatrixSettings(document.matrix_settings??{});
    setResultWindow(null);
    const models = nodes.filter(node=>node.type==='model').map(node=>({
      ...node, ...modelDimensions(document.model_sizes?.[node.id]),
      selected:false, dragging:false,
      position:document.model_positions?.[node.id]??{x:100,y:100},
      hidden:Boolean(document.used_models?.includes(node.id)&&document.hidden_models?.includes(node.id)),
      data:{...node.data,inUse:Boolean(document.used_models?.includes(node.id)),
        hasPosition:Boolean(document.model_positions?.[node.id]),noteHtml:cleanNoteHtml(document.model_notes?.[node.id]),stackId:null}
    }));
    setNodes([...restoreStacks(models,document.stacks),...(document.notes??[]).map(normalizeNote),...loadDecorations(document.decorations)]);
    setEdges(document.edges??[]);
    setContextMenu(null);setArrowMenu(null);setDecorationMenu(null);setStackDialog(null);
    setDrawMode(null);setDrawPreview(null);drawStart.current=null;
  }
  const history = usePageHistory({store:historyStore,pageId,ready:modelsLoaded&&!refreshingLibrary,
    signature:nodes.filter(node=>node.type==='model').map(node=>node.id).sort().join('\n'),
    layout:getCurrentLayout(),restore:restoreHistory});
  useEffect(() => {
    if (!modelsLoaded) return;
    const layout=getCurrentLayout(), encoded=JSON.stringify(layout);
    retainedLayout.current=layout;
    if (publishedLayout.current===encoded) return;
    publishedLayout.current=encoded;
    onLayoutChange(pageId,layout);
  });
  useEffect(() => {
    const api = { id: pageId, ready: modelsLoaded, snapshot: getCurrentLayout };
    controllerRef.current = api;
    return () => { if (controllerRef.current === api) controllerRef.current = null; };
  });

  useEffect(() => {
    if(!findRequest||!modelsLoaded||!flowInstance||handledFind.current===findRequest.token)return;
    handledFind.current=findRequest.token;
    const {item}=findRequest;
    let node=nodes.find(n=>n.id===item.id);
    const revealLibrary=n=>{
      setLibraryOpen(true);setLibraryQuery('');setFoundLibraryId(n.id);
      updateLibraryPrefs({Available:false,'In Use':false,Hidden:false,filter:'all'});
      onFindResult(findRequest.token,'Shown in the model library. Use its controls to show, return, or unstack it.',false);
    };
    if(item.kind==='model-note'&&node){
      if(node.data.stackId)selectVersion(node.data.stackId,node.id);
      openResults(node.id,'notes');
      onFindResult(findRequest.token,'Opened the model’s Notes editor. Clear its text to remove the note.',false);return;
    }
    if(node?.data.stackId)node=nodes.find(n=>n.id===node.data.stackId);
    if(node){
      if(['model','stack'].includes(node.type)&&(!node.data.inUse||node.hidden)){revealLibrary(node);return;}
      setNodes(current=>current.map(n=>({...n,selected:n.id===node.id})));
      setEdges(current=>current.map(e=>({...e,selected:false})));
      flowInstance.fitView({nodes:[{id:node.id}],padding:0.5,maxZoom:1,duration:250});
      onFindResult(findRequest.token,'Selected on the canvas. Use its right-click menu to remove it.',false);return;
    }
    const edge=item.kind==='edge'?edges.find(e=>e.id===item.id):null;
    if(edge){
      const endpoints=[edge.source,edge.target].map(id=>nodes.find(n=>n.id===id)).filter(Boolean);
      const hidden=endpoints.find(n=>n.hidden||(['model','stack'].includes(n.type)&&!n.data.inUse));
      if(hidden)revealLibrary(hidden);
      else if(endpoints.length)flowInstance.fitView({nodes:endpoints,padding:0.5,maxZoom:1,duration:250});
      setEdges(current=>current.map(e=>({...e,selected:e.id===edge.id})));
      if(edge.data?.noteHtml)setArrowNoteId(edge.id);
      onFindResult(findRequest.token,hidden?'This arrow connects a hidden or unused item. Its library entry is highlighted.':'Selected the arrow and centered its endpoints.',true);return;
    }
    onFindResult(findRequest.token,'This saved item cannot be displayed. Its source files may be missing. You can remove its saved data from this page.',true);
  });
  useEffect(()=>{
    if(foundLibraryId&&libraryOpen)libraryCards.current.get(foundLibraryId)?.scrollIntoView({block:'nearest'});
  },[foundLibraryId,libraryOpen,libraryQuery,libraryPrefs]);

  // ====================================================
  // Connect nodes
  // ====================================================

  const onConnect = useCallback(
    connection => {
      setEdges(current =>
        addEdge(connection, current)
      );
    },
    [setEdges]
  );

  // ====================================================
  // Add note
  // ====================================================

  function addNote() {
    let position = {
      x: 200,
      y: 200
    };

    if (flowInstance && canvasRef.current) {
      const bounds = canvasRef.current.getBoundingClientRect();

      position = flowInstance.screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2
      });
    }

    const id = `note-${Date.now()}`;

    setNodes(current => [
      ...current,
      {
        id,
        type: 'note',
        position,
        width: 260,
        height: 180,
        data: {
          title: 'Finding',
          text: '',
          collapsed: false
        }
      }
    ]);
  }

  // ====================================================
  // Delete note
  // ====================================================

  function deleteNote(nodeId) {
    setNodes(current =>
      current.filter(node => node.id !== nodeId)
    );

    setEdges(current =>
      current.filter(edge =>
        edge.source !== nodeId &&
        edge.target !== nodeId
      )
    );

    setContextMenu(null);
  }

  // ====================================================
  // Hide model
  // ====================================================

  function hideModel(nodeId) {
    setNodes(current =>
      current.map(node =>
        node.id === nodeId
          ? { ...node, hidden: true }
          : node
      )
    );

    setComparisonIds(current =>
      current.filter(id => comparisonIdentity(id).modelId !== nodeId)
    );

    setContextMenu(null);
  }

  // ====================================================
  // Restore all hidden models
  // ====================================================

  function restoreHiddenModels() {
    setNodes(current =>
      current.map(node =>
        node.type !== 'note' && !node.data.stackId && node.data.inUse
          ? { ...node, hidden: false }
          : node
      )
    );
  }

  // ====================================================
  // Comparison selection
  // ====================================================

  function variantsFor(id){return nodes.find(n=>n.id===id)?.data.methodSummary?.variants??[];}
  function activeVariant(id){const vs=variantsFor(id);return vs.find(v=>v.id===variantSelections[id])?.id??vs.find(v=>v.id===nodes.find(n=>n.id===id)?.data.methodSummary?.defaultVariant)?.id??vs[0]?.id;}
  function selectedSummary(id){const node=nodes.find(n=>n.id===id);return variantsFor(id).find(v=>v.id===activeVariant(id))?.summary??node?.data.methodSummary;}
  function activeComparisonKey(id){return comparisonKey(id,activeVariant(id));}
  function selectFitVariant(id,variantId){setVariantSelections(current=>({...current,[id]:variantId}));if(resultWindow?.nodeId===id)openResults(id,resultWindow.view,variantId);}
  function toggleComparisonModel(nodeId) {
    if(!nodeId.startsWith('cfa:')&&!comparisonIds.includes(nodeId))nodeId=activeComparisonKey(nodeId);
    if(!comparisonIds.includes(nodeId)&&comparisonIds.length>=5){setCanvasNotice('You can compare up to five models at a time.');return;}
    const next=comparisonIds.includes(nodeId)?comparisonIds.filter(id=>id!==nodeId):[...comparisonIds,nodeId];
    setComparisonIds(next);dismissContextMenus();
    if(comparisonWindow&&next.length>=2)openComparison(comparisonWindow.view,next);
    else {comparisonRequest.current++;setComparisonWindow(null);}
  }

  function clearComparison() {
    comparisonRequest.current++;
    setComparisonIds([]);
    setComparisonWindow(null);
  }

  async function openComparison(view = 'overview', ids = comparisonIds) {
    dismissContextMenus();
    const request=++comparisonRequest.current;
    if (ids.length < 2) {
      alert('Select at least two models to compare.');
      return;
    }

    const selectedNodes = ids
      .map(id => {const identity=comparisonIdentity(id);const node=nodes.find(node=>node.id===identity.modelId);return node?{...node,comparisonId:id,variantId:identity.variantId}:null;})
      .filter(node => node?.type === 'model');

    setComparisonWindow({
      view,
      loading: true,
      error: null,
      models: selectedNodes.map(node => ({
        id: node.comparisonId,
        title: node.data.title,
        data: null
      }))
    });

    try {
      const loadedModels = await Promise.all(
        selectedNodes.map(async node => {
          const response = await fetch(
            `${BASE}${node.data.results}`,
            { cache: 'no-store' }
          );

          if (!response.ok) {
            throw new Error(
              `Could not load ${node.data.title} (${response.status}).`
            );
          }

          const selected=selectResult(await response.json(),node.variantId);
          return {id:node.comparisonId,title:node.data.title+(selected.isCfaVariant?' — '+(selected.label||selected.id):''),data:normalizeResultData(selected)};
        })
      );

      if(request!==comparisonRequest.current)return;
      setComparisonWindow(current => ({
        ...current,
        models: loadedModels,
        loading: false
      }));
    } catch (error) {
      if(request!==comparisonRequest.current)return;
      setComparisonWindow(current => ({
        ...current,
        loading: false,
        error: error.message
      }));
    }
  }

  // ====================================================
  // Right-click menu
  // ====================================================

  const onNodeContextMenu = useCallback(
    (event, node) => {
      if (node.type !== 'note' && event.target.closest('input, textarea, [contenteditable]')) {
        return;
      }

      event.preventDefault();

      const menuWidth = 230;
      const menuHeight = node.type === 'note' ? 145 : 650;

      setContextMenu({
        nodeId: node.id,
        nodeType: node.type,
        title: node.data.title,
        x: Math.min(
          event.clientX,
          Math.max(10, window.innerWidth - menuWidth - 10)
        ),
        y: Math.min(
          event.clientY,
          Math.max(10, window.innerHeight - menuHeight - 10)
        )
      });
    },
    []
  );

  // ====================================================
  // Open single-model results
  // ====================================================

  async function openResults(nodeId, view, requestedVariant = activeVariant(nodeId)) {
    const request=++resultRequest.current;
    const node = nodes.find(item => item.id === nodeId);

    if (!node || node.type !== 'model') {
      return;
    }

    setContextMenu(null);

    setResultWindow({
      nodeId,
      title: node.data.title,
      view,
      data: null,
      loading: true,
      error: null
    });

    try {
      const response = await fetch(
        `${BASE}${node.data.results}`,
        { cache: 'no-store' }
      );

      if (!response.ok) {
        throw new Error(
          `Could not load results (${response.status}).`
        );
      }

      const raw=await response.json();
      if(request!==resultRequest.current)return;
      const selected=selectResult(raw,requestedVariant);
      const data=normalizeResultData(selected);
      const variants=variantsOf(raw).map(v=>({id:v.id,label:v.label,summary:getMethodSummary(v)}));
      const summary={...getMethodSummary(data),variants,defaultVariant:raw.default_variant};
      const safeView=resultViewsFor(summary).some(([key])=>key===view)?view:'overview';

      setNodes(current => current.map(item => item.id === nodeId
        ? { ...item, data: { ...item.data, methodSummary: summary } } : item));
      setResultWindow(current => current?.nodeId === nodeId ? ({
        ...current,
        data, variants, variantId:selected.isCfaVariant?selected.id:null, view:safeView,
        loading: false
      }) : current);
    } catch (error) {
      if(request!==resultRequest.current)return;
      setResultWindow(current => current?.nodeId === nodeId ? ({
        ...current,
        loading: false,
        error: error.message
      }) : current);
    }
  }

  // ====================================================
  // Apply layout.json
  // ====================================================

  // ====================================================
  // Hidden edges
  // ====================================================

  // Keep unused models in state so their positions and connections survive.
  // Only the rendered copy uses hidden for library membership.
  const shapeRanks = new Map(nodes.filter(node=>node.type==='shape').sort((a,b)=>(a.data.order??0)-(b.data.order??0)).map((node,i)=>[node.id,-1000000+i]));
  const renderedNodes = displayVersionNodes(nodes).map(original => {
    const node={...original,zIndex:10};
    if(isDecoration(node)) return {...node,zIndex:node.type==='container'?-2000000:shapeRanks.get(node.id),data:{...node.data,
      onResizeStart:()=>resizeBefore.current.set(node.id,{...original,position:{...original.position},data:{...original.data}}),
      onResizeEnd:(_event,params)=>finishDecorationResize(node.id,params)}};
    if (node.type === 'note' || isDecoration(node)) return node;
    const modelId = node.type === 'stack' ? node.data.activeId : node.id;
    const model = nodes.find(item => item.id === modelId);
    return { ...node, data: { ...node.data, methodSummary:selectedSummary(modelId), noteHtml: model?.data.noteHtml ?? '',
      onOpenNotes: () => openResults(modelId, 'notes') } };
  });
  const canvasNotes = nodes.filter(node => node.type === 'note');
  const allNotesCollapsed = canvasNotes.length > 0 && canvasNotes.every(node => node.data.collapsed);
  const hiddenIds = new Set(
    renderedNodes
      .filter(node => node.hidden)
      .map(node => node.id)
  );

  const renderedEdges = edges.map(edge => ({
    ...edge,
    type: 'annotated',
    style: { stroke: arrowAppearance(edge).color, strokeWidth: arrowAppearance(edge).thickness },
    markerStart: arrowMarker(edge, 'start'),
    markerEnd: arrowMarker(edge, 'end'),
    data: { ...edge.data, noteHtml: cleanNoteHtml(edge.data?.noteHtml),
      onOpenNote: () => { setArrowNoteId(edge.id); setArrowMenu(null); },
      onMenu: event => openArrowMenu(event, edge) },
    hidden:
      hiddenIds.has(edge.source) ||
      hiddenIds.has(edge.target)
  }));

  const hiddenModelCount = nodes.filter(
    node =>
      node.type !== 'note' &&
      !node.data.stackId &&
      node.data.inUse &&
      node.hidden
  ).length;

  // ====================================================
  // Render
  // ====================================================

  const libraryModels = nodes.filter(node => node.type === 'model');
  const query = libraryQuery.trim().toLowerCase();
  const matchesQuery = node =>
    (node.id + ' ' + node.data.title).toLowerCase().includes(query);
  const libraryItems = nodes.filter(node => ['model','stack'].includes(node.type) && !node.data.stackId);
  const matchesItem = node => matchesQuery(node) || (node.type === 'stack' && node.data.memberIds.some(id => {
    const model = nodes.find(item => item.id === id);
    return model && matchesQuery(model);
  }));
  const availableModels = libraryItems.filter(node => !node.data.inUse);
  const usedModels = libraryItems.filter(node => node.data.inUse && !node.hidden);
  const hiddenLibraryModels = libraryItems.filter(node=>node.data.inUse && node.hidden);
  const editedDecoration=nodes.find(node=>node.id===decorationMenu?.id);
  const editedArrow = edges.find(edge => edge.id === arrowMenu?.id);
  const arrowSettings = editedArrow ? arrowAppearance(editedArrow) : ARROW_DEFAULTS;
  const notedArrow = edges.find(edge => edge.id === arrowNoteId);
  const menuNode = nodes.find(node => node.id === contextMenu?.nodeId);
  const menuModelId = menuNode?.type === 'stack' ? menuNode.data.activeId : menuNode?.id;
  const comparisonCandidates=nodes.filter(n=>n.type==='model').flatMap(node=>{
    const variants=variantsFor(node.id);
    return variants.length?variants.map(v=>({...node,id:comparisonKey(node.id,v.id),data:{...node.data,title:node.data.title+' — '+(v.label||v.id)}})):[node];
  }).filter(node=>!comparisonIds.includes(node.id)&&(node.id+' '+node.data.title).toLowerCase().includes(queueQuery.trim().toLowerCase()));

  return (
    <div className="app">
      <div
        className="canvas"
        ref={canvasRef}
        onDrop={onLibraryDrop}
        onDragOver={event => {
          if (event.dataTransfer.types.includes('application/x-sem-model')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
      >
        <div className="layout-toolbar" onClickCapture={dismissContextMenus}>
          <button aria-label={toolsOpen ? 'Hide tools' : 'Show tools'} title={toolsOpen ? 'Hide tools' : 'Show tools'}
            aria-expanded={toolsOpen} aria-controls="canvas-tools" onClick={toggleTools}>☰</button>
          {toolsOpen && <div id="canvas-tools" className="toolbar-items">
          <button disabled={!history.canUndo} onClick={history.undo} title="Undo on this page (Ctrl+Z)">↶ Undo</button>
          <button disabled={!history.canRedo} onClick={history.redo} title="Redo on this page (Ctrl+Shift+Z or Ctrl+Y)">↷ Redo</button>
          <button disabled={!modelsLoaded} onClick={()=>{setDrawMode('container');setCanvasNotice('Drag on the canvas to draw a container. Escape cancels.');}}>Draw container</button>
          <select aria-label="Shape type" value={shapeKind} onChange={event=>setShapeKind(event.target.value)}><option value="rectangle">Rectangle</option><option value="circle">Circle</option><option value="rounded">Rounded rectangle</option></select>
          <button disabled={!modelsLoaded} onClick={()=>{setDrawMode('shape');setCanvasNotice('Drag on the canvas to draw a shape. Escape cancels.');}}>Draw shape</button>
          <button onClick={addNote} disabled={!modelsLoaded}>
            + Note
          </button>

          <button disabled={!modelsLoaded || canvasNotes.length === 0}
            title="Expand or collapse all canvas notes"
            onClick={() => setNodes(current => current.map(node => setNoteCollapsed(node, !allNotesCollapsed)))}>
            {allNotesCollapsed ? 'Expand All' : 'Collapse All'}
          </button>

          {supportsModels && <><button
            className={comparisonIds.length >= 2 ? 'compare-ready' : ''}
            onClick={() => openComparison('overview')}
            disabled={!modelsLoaded || comparisonIds.length < 2}
            title="Right-click models to add them to the comparison"
          >
            Compare ({comparisonIds.length})
          </button>

          <div className="comparison-queue">
            <button aria-expanded={queueOpen} aria-controls="comparison-queue-panel" onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();setQueuePosition({left:Math.max(12,Math.min(rect.left,window.innerWidth-362)),top:rect.bottom+8,maxHeight:Math.max(160,window.innerHeight-rect.bottom-24)});setQueueOpen(value=>!value);}}>Comparison queue ({comparisonIds.length}) ▾</button>
            {queueOpen&&<div id="comparison-queue-panel" className="comparison-queue-panel" style={queuePosition} role="dialog" aria-label="Comparison queue" onKeyDown={event=>event.stopPropagation()}>
              <div className="queue-heading"><strong>Models to compare</strong><button disabled={!comparisonIds.length} onClick={clearComparison}>Clear all</button></div>
              <div className="queue-items">{comparisonIds.map(id=>{
                const identity=comparisonIdentity(id);const model=nodes.find(node=>node.id===identity.modelId);const variant=variantsFor(identity.modelId).find(v=>v.id===identity.variantId);
                return <div className="queue-item" key={id}><span>{model?.data.title??id}{variant?" — "+(variant.label||variant.id):""}<small>{identity.variantId??identity.modelId}</small></span><button aria-label={'Remove '+id+' from comparison'} onClick={()=>toggleComparisonModel(id)}>×</button></div>;
              })}{!comparisonIds.length&&<p>No models queued.</p>}</div>
              <label className="queue-search">Add a model<input type="search" aria-label="Search models to compare" placeholder="Model name or ID…" value={queueQuery} onChange={event=>setQueueQuery(event.target.value)} /></label>
              <div className="queue-search-results">{comparisonCandidates.map(node=><div className="queue-item" key={node.id}><span>{node.data.title}<small>{comparisonIdentity(node.id).variantId??node.id}{node.data.stackId?' · Stack version':''}</small></span><button disabled={comparisonIds.length>=5} aria-label={'Add '+node.id+' to comparison'} onClick={()=>toggleComparisonModel(node.id)}>Add</button></div>)}{!comparisonCandidates.length&&<p>No matching models available to add.</p>}</div>
              <small className="queue-help">Up to five models. Includes available, hidden, and stacked versions.</small>
            </div>}
          </div>

          <button
            onClick={() => setLibraryOpen(current => !current)}
            aria-expanded={libraryOpen}
            aria-controls="model-library"
          >
            {libraryOpen ? 'Close library' : 'Model library'}
          </button>

          {hiddenModelCount > 0 && (
            <button onClick={restoreHiddenModels}>
              Restore hidden ({hiddenModelCount})
            </button>
          )}
          </>}
          </div>}
        </div>

        {canvasNotice && <div className="canvas-notice" role="status">{canvasNotice}<button aria-label="Dismiss canvas message" onClick={()=>setCanvasNotice('')}>×</button></div>}
        {drawMode && <div className="drawing-overlay" onPointerDown={event=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);drawStart.current={x:event.clientX,y:event.clientY};}}
          onPointerMove={event=>{if(drawStart.current){const rect=event.currentTarget.getBoundingClientRect();setDrawPreview({...drawingBox(drawStart.current,{x:event.clientX,y:event.clientY}),offsetX:rect.left,offsetY:rect.top});}}}
          onPointerUp={finishDrawing} onPointerCancel={()=>{drawStart.current=null;setDrawPreview(null);setDrawMode(null);}}>
          {drawPreview && <div className="drawing-preview" style={{left:drawPreview.x-drawPreview.offsetX,top:drawPreview.y-drawPreview.offsetY,width:drawPreview.width,height:drawPreview.height,borderRadius:drawMode==='shape'&&shapeKind==='circle'?'50%':drawMode==='shape'&&shapeKind==='rounded'?20:0}} />}
        </div>}
        <ReactFlow
          nodes={renderedNodes}
          edges={renderedEdges}
          onNodesChange={handleNodeChanges}
          elevateNodesOnSelect={false}
          selectionOnDrag={false}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          connectionMode={ConnectionMode.Loose}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onEdgeContextMenu={openArrowMenu}
          defaultEdgeOptions={defaultEdgeOptions}
          onInit={setFlowInstance}
          onNodeContextMenu={(event, node) => { setArrowMenu(null); if(isDecoration(node)){openDecorationMenu(event,node);return;} setDecorationMenu(null);onNodeContextMenu(event, node); }}
          onPaneClick={() => { setContextMenu(null); setArrowMenu(null); }}
          deleteKeyCode={stackDialog ? null : ['Backspace', 'Delete']}
          defaultViewport={validViewport(initialPageLayout.viewport) ?? {x:0,y:0,zoom:1}}
          fitView={!validViewport(initialPageLayout.viewport) && Boolean(initialPageLayout.used_models?.length || initialPageLayout.notes?.length || initialPageLayout.decorations?.length || initialPageLayout.stacks?.some(stack=>stack.in_use))}
          onMoveEnd={(_event,nextViewport)=>setViewport(nextViewport)}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      {supportsModels && libraryOpen && (
        <aside className="model-library" id="model-library" aria-label="Model library" onKeyDown={event => event.stopPropagation()}>
          <div className="library-header">
            <h2>Model library</h2>
            <button onClick={refreshLibrary} disabled={refreshingLibrary}>
              {refreshingLibrary ? 'Refreshing…' : 'Refresh library'}
            </button>
          </div>
          <p className="library-help">Drag a model onto the canvas or choose Use.</p>
          <input
            className="library-search"
            type="search"
            aria-label="Search models"
            placeholder="Search models…"
            value={libraryQuery}
            onChange={event => setLibraryQuery(event.target.value)}
          />
          {libraryError && <p className="library-error" role="alert">{libraryError}</p>}
          {libraryNotice && !libraryError && <p className="library-help" role="status">{libraryNotice}</p>}
          {!modelsLoaded && !libraryError && <p role="status">Loading models…</p>}
          <div className="library-sections">
            {[['Available',availableModels],['In Use',usedModels],['Hidden',hiddenLibraryModels]].map(([label,items])=>{
              const visible=items.filter(matchesItem).filter(node=>label!=='In Use'||!libraryPrefs.filter||libraryPrefs.filter==='all'||(libraryPrefs.filter==='stacks'?node.type==='stack':node.type==='model'));
              const collapsed=Boolean(libraryPrefs[label]);
              return <section className="library-section" key={label}>
                <h3><button className="library-section-toggle" aria-expanded={!collapsed} onClick={()=>updateLibraryPrefs({[label]:!collapsed})}>{collapsed?'▸':'▾'} {label} <span>{items.length}</span></button></h3>
                {!collapsed && <>
                  {label==='In Use' && <label className="library-filter">Show <select aria-label="Filter in-use library items" value={libraryPrefs.filter??'all'} onChange={event=>updateLibraryPrefs({filter:event.target.value})}>
                    <option value="all">All</option><option value="stacks">Stacks only</option><option value="standalone">Standalone only</option></select></label>}
                  {visible.map(renderLibraryItem)}
                  {visible.length===0 && <p className="library-empty">{items.length?'No items match this search or filter.':label==='Hidden'?'No hidden models.':label==='Available'?'No unused models.':'No visible models in use.'}</p>}
                </>}
              </section>;
            })}
            <section className="library-section library-broken">
              <h3><button className="library-section-toggle" aria-expanded={!libraryPrefs.Broken} onClick={()=>updateLibraryPrefs({Broken:!libraryPrefs.Broken})}>
                {libraryPrefs.Broken?'▸':'▾'} Broken <span>{brokenModels.length}</span>
              </button></h3>
              {!libraryPrefs.Broken && <>
                <p className="library-help">Match the filename before .svg and .json exactly, including case. Add or repair the file, then refresh.</p>
                {brokenModels.filter(model=>(model.id+' '+model.title).toLowerCase().includes(query)).map(model=><article className="library-card broken-model-card" key={model.id}>
                  <strong>{model.id}</strong>
                  <span className={model.image?'file-present':'file-missing'}>SVG: {model.image?'Present':'Missing'}</span>
                  <span className={model.results?'file-present':'file-missing'}>JSON: {model.results?'Present':'Missing'}</span>
                  {model.imageFiles?.length>0&&<small>web/models/{model.imageFiles.join(', ')}</small>}
                  {model.resultFiles?.length>0&&<small>web/results/{model.resultFiles.join(', ')}</small>}
                  <p>{model.reason}</p>
                </article>)}
                {!brokenModels.length&&<p className="library-empty">No broken pairs.</p>}
                {brokenModels.length>0&&!brokenModels.some(model=>(model.id+' '+model.title).toLowerCase().includes(query))&&<p className="library-empty">No broken items match this search.</p>}
              </>}
            </section>
          </div>
        </aside>
      )}


      {decorationMenu && editedDecoration && <div className="context-menu decoration-menu" role="dialog" aria-label="Shape and container appearance" style={{left:decorationMenu.x,top:decorationMenu.y}} onKeyDown={event=>event.stopPropagation()}>
        <div className="context-menu-title">{editedDecoration.type==='container'?'Container':'Shape'}<button aria-label="Close shape options" onClick={()=>setDecorationMenu(null)}>×</button></div>
        <label>Fill <input type="color" aria-label="Fill color" value={editedDecoration.data.fill} onChange={event=>updateDecoration({fill:event.target.value})}/></label>
        <label>Border <input type="color" aria-label="Border color" value={editedDecoration.data.border} onChange={event=>updateDecoration({border:event.target.value})}/></label>
        <label>Thickness {editedDecoration.data.thickness}<input type="range" aria-label="Border thickness" min="0" max="12" value={editedDecoration.data.thickness} onChange={event=>updateDecoration({thickness:Number(event.target.value)})}/></label>
        <label>Border style <select aria-label="Border style" value={editedDecoration.data.line} onChange={event=>updateDecoration({line:event.target.value})}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
        {editedDecoration.type==='shape' && <><hr/>{[['forward','Bring forward'],['backward','Send backward'],['front','Bring to front of shapes'],['back','Send to back of shapes']].map(([action,label])=><button key={action} onClick={()=>orderShape(action)}>{label}</button>)}</>}
        <hr/><button className="danger" onClick={()=>{setNodes(current=>current.filter(node=>node.id!==editedDecoration.id));setDecorationMenu(null);}}>Delete {editedDecoration.type}</button>
      </div>}
      {arrowMenu && editedArrow && <div className="context-menu arrow-menu" role="dialog" aria-label="Arrow options"
        style={{ left: arrowMenu.x, top: arrowMenu.y }} onContextMenu={event => event.preventDefault()}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') setArrowMenu(null); }}>
        <div className="context-menu-title">Arrow <button aria-label="Close arrow options" onClick={() => setArrowMenu(null)}>×</button></div>
        <label>Color <input aria-label="Arrow color" type="color" value={arrowSettings.color}
          onChange={event => updateArrow(editedArrow.id, { appearance: { ...arrowSettings, color: event.target.value } })} /></label>
        <div className="arrow-swatches">{['#64748b','#2563eb','#dc2626','#16a34a','#9333ea','#111827'].map(color =>
          <button key={color} title={color} aria-label={'Arrow color ' + color} style={{ backgroundColor: color }}
            onClick={() => updateArrow(editedArrow.id, { appearance: { ...arrowSettings, color } })} />)}</div>
        <label>Thickness {arrowSettings.thickness}<input aria-label="Arrow thickness" type="range" min="1" max="6" step="0.5" value={arrowSettings.thickness}
          onChange={event => updateArrow(editedArrow.id, { appearance: { ...arrowSettings, thickness: Number(event.target.value) } })} /></label>
        <label>Arrowhead <select aria-label="Arrowhead type" value={arrowSettings.head}
          onChange={event => updateArrow(editedArrow.id, { appearance: { ...arrowSettings, head: event.target.value } })}>
          <option value="none">None</option><option value="open">Open arrow</option><option value="filled">Filled triangle</option></select></label>
        <label>Arrowhead ends <select aria-label="Arrowhead ends" value={arrowSettings.ends}
          onChange={event => updateArrow(editedArrow.id, { appearance: { ...arrowSettings, ends: event.target.value } })}>
          <option value="none">Neither end</option><option value="start">Start only</option><option value="end">End only</option><option value="both">Both ends</option></select></label>
        <label>Arrowhead size {arrowSettings.size}<input aria-label="Arrowhead size" type="range" min="8" max="36" value={arrowSettings.size} disabled={arrowSettings.head === 'none'}
          onChange={event => updateArrow(editedArrow.id, { appearance: { ...arrowSettings, size: Number(event.target.value) } })} /></label>
        <button onClick={() => updateArrow(editedArrow.id, { appearance: { ...ARROW_DEFAULTS } })}>Reset appearance</button>
        <button onClick={() => { setEdges(current => current.map(edge => ({ ...edge, selected: edge.id === editedArrow.id }))); setArrowMenu(null); }}>Adjust bend…</button>
        <button onClick={() => updateArrow(editedArrow.id, { bend: null })}>Reset bend</button>
        <hr />
        <button onClick={() => { setArrowNoteId(editedArrow.id); setArrowMenu(null); }}>{cleanNoteHtml(editedArrow.data?.noteHtml) ? 'Edit note' : 'Add note'}</button>
        {cleanNoteHtml(editedArrow.data?.noteHtml) && <button onClick={() => { updateArrow(editedArrow.id, { noteHtml: '' }); setArrowNoteId(null); setArrowMenu(null); }}>Delete note</button>}
        <hr /><button className="danger" onClick={() => { setEdges(current => current.filter(edge => edge.id !== editedArrow.id)); setArrowMenu(null); }}>Delete arrow</button>
      </div>}
      {notedArrow && <Rnd key={notedArrow.id} className="result-window arrow-note-window" bounds="window"
        default={{ x: Math.max(10, window.innerWidth / 2 - 300), y: 90, width: Math.min(600, window.innerWidth - 20), height: 420 }}
        minWidth={350} minHeight={250} dragHandleClassName="arrow-note-dragbar">
        <div className="result-window-header"><div className="arrow-note-dragbar">Arrow notes</div>
          <button aria-label="Close arrow notes" onClick={() => setArrowNoteId(null)}>×</button></div>
        <div className="result-window-body notes-window-body"><RichModelNotes key={notedArrow.id}
          label="Arrow notes" placeholder="Write notes for this arrow…" value={notedArrow.data?.noteHtml ?? ''} onChange={html => updateArrow(notedArrow.id, { noteHtml: html })} /></div>
      </Rnd>}
      {/* Right-click context menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            maxHeight: Math.max(160, window.innerHeight-contextMenu.y-12)
          }}
        >
          <div className="context-menu-title">
            {menuNode?.data.title || 'Note'}
          </div>

          {contextMenu.nodeType !== 'note' ? (
            <>
              {menuNode?.type === 'stack' && (
                <div className="context-versions">
                  <strong>Displayed version</strong>
                  {menuNode.data.memberIds.map(id => (
                    <button key={id} aria-pressed={id === menuModelId}
                      className={id === menuModelId ? 'comparison-selected' : ''}
                      onClick={() => selectVersion(menuNode.id, id)}>
                      {id === menuModelId ? '● ' : '○ '}{nodes.find(node => node.id === id)?.data.title}
                      {comparisonIds.includes(id) ? ' · In comparison' : ''}
                    </button>
                  ))}
                </div>
              )}
              {variantsFor(menuModelId).length>1&&<label className="cfa-variant-selector">Estimation variant<select value={activeVariant(menuModelId)} onChange={e=>selectFitVariant(menuModelId,e.target.value)}>{variantsFor(menuModelId).map(v=><option key={v.id} value={v.id}>{v.label||v.id}</option>)}</select></label>}
              {resultViewsFor(selectedSummary(menuModelId)).filter(([key]) => key !== 'notes').map(([key, label]) => (
                <button
                  key={key}
                  onClick={() =>
                    openResults(
                      menuModelId,
                      key
                    )
                  }
                >
                  {label}
                </button>
              ))}

              <div className="context-divider" />

              <button onClick={() => openResults(menuModelId, 'notes')}>Notes</button>
              <div className="context-divider" />
              <button
                className={
                  comparisonIds.includes(activeComparisonKey(menuModelId))
                    ? 'comparison-selected'
                    : ''
                }
                onClick={() =>
                  toggleComparisonModel(menuModelId)
                }
              >
                {comparisonIds.includes(activeComparisonKey(menuModelId))
                  ? 'Remove from comparison'
                  : 'Add to comparison'}
              </button>

              <div className="context-divider" />

              <button
                onClick={() => hideModel(contextMenu.nodeId)}
              >
                Hide from map
              </button>
              <button onClick={() => returnToLibrary(contextMenu.nodeId)}>
                Return to library
              </button>
              <div className="context-divider" />
              <button onClick={() => startOrganizing(menuModelId)}>Stack / move displayed model…</button>
              {menuNode?.type === 'stack' && <>
                <button onClick={() => splitStack(menuNode.id, menuModelId)}>Detach displayed version</button>
                <button onClick={() => splitStack(menuNode.id)}>Dissolve stack</button>
              </>}
            </>
          ) : (
            <>
              <button onClick={() => {
                setNodes(current => current.map(node => node.id === contextMenu.nodeId ? setNoteCollapsed(node, !node.data.collapsed) : node));
                setContextMenu(null);
              }}>{menuNode?.data.collapsed ? 'Expand note' : 'Collapse note'}</button>
              <button className="danger" onClick={() => deleteNote(contextMenu.nodeId)}>Delete note</button>
            </>
          )}
        </div>
      )}

      {stackDialog && (
        <div className="stack-dialog-backdrop" onKeyDown={event => {
          if (event.key === 'Escape') setStackDialog(null);
          if (event.key === 'Tab') {
            const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
            if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
          }
          event.stopPropagation();
        }}>
          <form className="stack-dialog" role="dialog" aria-modal="true" aria-labelledby="stack-dialog-title" onSubmit={commitStack}>
            <h2 id="stack-dialog-title">Organize versions</h2>
            <label>Destination
              <select autoFocus value={stackDialog.target} onChange={event => setStackDialog(current => ({ ...current, target: event.target.value }))}>
                <option value="">Create a new stack</option>
                {nodes.filter(node => node.type === 'stack').map(node => <option key={node.id} value={node.id}>{node.data.title}</option>)}
              </select>
            </label>
            {!stackDialog.target && <>
              <label>Stack name<input value={stackDialog.name} onChange={event => setStackDialog(current => ({ ...current, name: event.target.value }))} /></label>
              <label>Keep this model's canvas position and usage
                <select value={stackDialog.anchor} onChange={event => setStackDialog(current => ({ ...current, anchor: event.target.value }))}>
                  {stackDialog.selected.map(id => <option key={id} value={id}>{nodes.find(node => node.id === id)?.data.title}</option>)}
                </select>
              </label>
            </>}
            <p>Select models to include. External arrows follow the stack; arrows between combined models are removed. Moving to an existing stack uses its position and Use setting.</p>
            <fieldset className="stack-model-picker"><legend>Models</legend>
              {libraryModels.map(model => {
                const owner = nodes.find(node => node.id === model.data.stackId);
                const alreadyInTarget = Boolean(stackDialog.target && owner?.id === stackDialog.target);
                return <label key={model.id}>
                  <input type="checkbox" checked={alreadyInTarget || stackDialog.selected.includes(model.id)} disabled={alreadyInTarget}
                    onChange={event => {
                      const checked = event.target.checked;
                      setStackDialog(current => {
                        const selected = checked ? [...current.selected, model.id] : current.selected.filter(id => id !== model.id);
                        return { ...current, selected, anchor: selected.includes(current.anchor) ? current.anchor : selected[0] ?? '' };
                      });
                    }} />
                  <span>{model.data.title}<small>{owner ? 'In ' + owner.data.title : 'Standalone'}</small></span>
                </label>;
              })}
            </fieldset>
            {stackDialog.error && <p className="error-message" role="alert">{stackDialog.error}</p>}
            <div className="stack-dialog-actions">
              <button type="button" onClick={() => setStackDialog(null)}>Cancel</button>
              <button type="submit" disabled={stackDialog.selected.length < (stackDialog.target ? 1 : 2)}>
                {stackDialog.target ? 'Move into stack' : 'Create stack'}
              </button>
            </div>
          </form>
        </div>
      )}
      <MatrixSettingsContext.Provider value={{settings:matrixSettings,update:updateMatrixSettings}}>
      {/* Single-model results */}
      <ResultWindow
        onChangeVariant={id=>selectFitVariant(resultWindow.nodeId,id)}
        windowData={resultWindow}
        noteHtml={nodes.find(node => node.id === resultWindow?.nodeId)?.data.noteHtml ?? ''}
        onNotesChange={html => {
          const modelId = resultWindow?.nodeId;
          setNodes(current => current.map(node => node.id === modelId && node.type === 'model'
            ? { ...node, data: { ...node.data, noteHtml: html } } : node));
        }}
        onClose={() => {resultRequest.current++;setResultWindow(null);}}
        onChangeView={view =>
          setResultWindow(current => ({
            ...current,
            view
          }))
        }
      />

      {/* Multi-model comparison */}
      <ComparisonWindow
        windowData={comparisonWindow}
        onClose={() => {comparisonRequest.current++;setComparisonWindow(null);}}
        onChangeView={view =>
          setComparisonWindow(current => ({
            ...current,
            view
          }))
        }
      />
      </MatrixSettingsContext.Provider>
    </div>
  );
}
