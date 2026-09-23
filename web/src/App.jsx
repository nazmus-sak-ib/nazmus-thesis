import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';

import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  NodeResizer,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow
} from '@xyflow/react';

import { Rnd } from 'react-rnd';

import '@xyflow/react/dist/style.css';
import './App.css';

const BASE = import.meta.env.BASE_URL;
const STORAGE_KEY = 'sem-model-layout';

// ======================================================
// Connection handles
// ======================================================

function ConnectionHandles() {
  return (
    <>
      <Handle id="target-top" type="target" position={Position.Top} />
      <Handle id="target-left" type="target" position={Position.Left} />
      <Handle id="source-right" type="source" position={Position.Right} />
      <Handle id="source-bottom" type="source" position={Position.Bottom} />
    </>
  );
}

// ======================================================
// Model node
// ======================================================

function ModelNode({ data }) {
  return (
    <div className="model-node">
      <ConnectionHandles />

      <img
        src={`${BASE}${data.image}`}
        alt={data.title}
      />

      <div className="model-title">
        {data.title}
      </div>
    </div>
  );
}

// ======================================================
// Editable note node
// ======================================================

function NoteNode({ id, data, selected }) {
  const { updateNodeData } = useReactFlow();

  return (
    <div className="note-node">
      <NodeResizer
        isVisible={selected}
        minWidth={150}
        minHeight={90}
        handleStyle={{
          width: 14,
          height: 14
        }}
      />

      <ConnectionHandles />

      <input
        className="note-title nodrag"
        value={data.title ?? ''}
        placeholder="Heading"
        onContextMenu={event => event.stopPropagation()}
        onChange={event =>
          updateNodeData(id, {
            title: event.target.value
          })
        }
      />

      <textarea
        className="note-text nodrag nowheel"
        value={data.text ?? ''}
        placeholder="Type here..."
        onContextMenu={event => event.stopPropagation()}
        onChange={event =>
          updateNodeData(id, {
            text: event.target.value
          })
        }
      />
    </div>
  );
}

// Stack nodes own canvas geometry; model nodes retain individual results identity.
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
      id: saved.id, type: 'stack', deletable: false,
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
    id: destinationId, type: 'stack', deletable: false,
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
    if (node.type === 'note') return node;
    if (node.type === 'model') return node.data.stackId || !node.data.inUse
      ? { ...node, hidden: true, selected: false } : node;
    const active = byId.get(node.data.activeId);
    return { ...node, hidden: !node.data.inUse || node.hidden,
      data: { ...node.data, image: active?.data.image,
        activeTitle: active?.data.title ?? node.data.activeId,
        versionIndex: node.data.memberIds.indexOf(node.data.activeId) + 1 } };
  });
}

function StackNode({ data }) {
  return (
    <div className="model-node version-stack">
      <ConnectionHandles />
      <div className="stack-caption">{data.title} <span>{data.versionIndex} of {data.memberIds.length}</span></div>
      <img src={BASE + data.image} alt={data.activeTitle} />
      <div className="model-title">{data.activeTitle}</div>
    </div>
  );
}


const nodeTypes = {
  stack: StackNode,
  model: ModelNode,
  note: NoteNode
};

const defaultEdgeOptions = {
  type: 'smoothstep',
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
  ['r2', 'R²'],
  ['mi', 'Modification indices']
];

function ResultContent({ data, view }) {
  if (!data) {
    return null;
  }

  const metadata = data.metadata ?? {};

  function fit(name) {
    return data.fit_measures
      ?.find(row => row.measure === name)
      ?.value;
  }

  if (view === 'overview') {
    const totalN = data.sample_size
      ?.reduce((sum, row) => sum + Number(row.n || 0), 0);

    const rows = [
      { item: 'Model ID', value: metadata.model_id },
      { item: 'Model name', value: metadata.model_name },
      { item: 'Estimator', value: metadata.estimator },
      { item: 'N', value: totalN },
      { item: 'Parameters', value: metadata.number_parameters },
      { item: 'Groups', value: metadata.number_groups },
      { item: 'Converged', value: metadata.converged },
      { item: 'Robust CFI', value: fit('cfi.robust') },
      { item: 'Robust TLI', value: fit('tli.robust') },
      { item: 'Robust RMSEA', value: fit('rmsea.robust') },
      { item: 'SRMR', value: fit('srmr') }
    ].filter(row => row.value !== null && row.value !== undefined);

    return (
      <DataTable
        rows={rows}
        preferredColumns={['item', 'value']}
      />
    );
  }

  if (view === 'fit') {
    return (
      <DataTable
        rows={data.fit_measures}
        preferredColumns={['measure', 'value']}
      />
    );
  }

  if (view === 'paths') {
    const rows = data.parameters
      ?.filter(row => row.section === 'regression') ?? [];

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

  if (view === 'loadings') {
    const rows = data.parameters
      ?.filter(row => row.section === 'loading') ?? [];

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
  onChangeView
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

      <div className="result-tabs">
        {RESULT_VIEWS.map(([key, label]) => (
          <button
            key={key}
            className={windowData.view === key ? 'active' : ''}
            onClick={() => onChangeView(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="result-window-body">
        {windowData.loading ? (
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
  ['r2', 'R²'],
  ['mi', 'Modification indices']
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
  const data = model.data ?? {};
  const metadata = data.metadata ?? {};

  const totalN = data.sample_size
    ?.reduce((sum, row) => sum + Number(row.n || 0), 0);

  return {
    'Model ID': metadata.model_id,
    'Model name': metadata.model_name,
    'Estimator': metadata.estimator,
    'N': totalN,
    'Parameters': metadata.number_parameters,
    'Groups': metadata.number_groups,
    'Converged': metadata.converged,
    'Robust CFI': getFitValue(data, 'cfi.robust'),
    'Robust TLI': getFitValue(data, 'tli.robust'),
    'Robust RMSEA': getFitValue(data, 'rmsea.robust'),
    'SRMR': getFitValue(data, 'srmr')
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
    data => (data.parameters ?? []).filter(row => row.section === section),
    parameterKey
  );

  const fieldLabels = Object.fromEntries(PARAMETER_FIELDS);

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

  if (view === 'overview') {
    const overviewMaps = models.map(getOverviewItems);

    const rowLabels = unionInOrder(
      overviewMaps.map(itemMap => Object.keys(itemMap))
    );

    return (
      <SimpleComparisonTable
        models={models}
        rowLabels={rowLabels}
        valueGetter={(model, label) => {
          const index = models.findIndex(item => item.id === model.id);
          return overviewMaps[index]?.[label];
        }}
      />
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

  if (view === 'paths' || view === 'loadings') {
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

        <ParameterComparisonTable
          models={models}
          section={view === 'paths' ? 'regression' : 'loading'}
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
        {COMPARISON_VIEWS.map(([key, label]) => (
          <button
            key={key}
            className={windowData.view === key ? 'active' : ''}
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

export default function App() {
  const [
    nodes,
    setNodes,
    onNodesChange
  ] = useNodesState([]);

  const [
    edges,
    setEdges,
    onEdgesChange
  ] = useEdgesState([]);

  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [refreshingLibrary, setRefreshingLibrary] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [libraryQuery, setLibraryQuery] = useState('');
  const refreshPending = useRef(false);
  const [layoutHandle, setLayoutHandle] = useState(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const savePending = useRef(false);
  const [flowInstance, setFlowInstance] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [stackDialog, setStackDialog] = useState(null);
  const [resultWindow, setResultWindow] = useState(null);

  const [comparisonIds, setComparisonIds] = useState([]);
  const [comparisonWindow, setComparisonWindow] = useState(null);

  const canvasRef = useRef(null);

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
    return {
      id: note.id ?? `note-${Date.now()}`,
      type: 'note',
      position: note.position ?? {
        x: 200,
        y: 200
      },
      width: note.width ?? 230,
      height: note.height ?? 150,
      data: {
        title: note.data?.title ?? 'Finding',
        text: note.data?.text ?? ''
      }
    };
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

    const round = value =>
      Math.round(value * 100) / 100;

    nodes.forEach(node => {
      const position = {
        x: round(node.position.x),
        y: round(node.position.y)
      };

      if (node.type === 'model') {
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
          active_model: node.data.activeId, position,
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
            text: node.data.text ?? ''
          }
        });
      }
    });

    const savedEdges = edges.map(edge => {
      const saved = {
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

    return {
      schema_version: '5.0',
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

  async function fetchCatalog() {
    const response = await fetch(
      BASE + 'models.json',
      { cache: 'no-store' }
    );
    if (!response.ok) {
      throw new Error('Could not load the model library (' + response.status + ').');
    }
    const catalog = await response.json();
    if (!Array.isArray(catalog.models)) {
      throw new Error('models.json must contain a models array.');
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
    return catalog.models;
  }

  function createModelNode(model) {
    return {
      id: model.id,
      type: 'model',
      deletable: false,
      hidden: false,
      position: { x: 100, y: 100 },
      data: {
        title: model.title || model.id,
        image: model.image,
        results: model.results,
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
        const catalog = await fetchCatalog();
        let browserLayout = {};
        try {
          const saved = localStorage.getItem(STORAGE_KEY);
          browserLayout = JSON.parse(saved || '{}') || {};
          // Keep the pre-library browser layout for rollback, once only.
          if (saved && !localStorage.getItem(STORAGE_KEY + '-before-version-stacks')) {
            localStorage.setItem(STORAGE_KEY + '-before-version-stacks', saved);
          }
        } catch {
          // A blocked storage API must not prevent loading the file layout.
        }

        let fileLayout = {};
        try {
          const response = await fetch(BASE + 'layout.json', { cache: 'no-store' });
          if (response.ok) fileLayout = (await response.json()) || {};
        } catch {
          // A layout file is optional; new models start in the library.
        }

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

        const modelNodes = catalog.map(model => {
          const node = createModelNode(model);
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
        setNodes([...restoreStacks(modelNodes, savedStacks), ...noteSource.map(normalizeNote)]);
        setEdges(loadedEdges);
        setModelsLoaded(true);
      } catch (error) {
        if (!cancelled) setLibraryError(error.message);
      }
    }
    loadEverything();
    return () => { cancelled = true; };
  }, [setNodes, setEdges, loadAttempt]);

  async function refreshLibrary() {
    if (!modelsLoaded) {
      setLoadAttempt(current => current + 1);
      return;
    }
    if (refreshPending.current) return;
    refreshPending.current = true;
    setRefreshingLibrary(true);
    setLibraryError('');
    try {
      const catalog = await fetchCatalog();
      setNodes(current => {
        const byId = new Map(catalog.map(model => [model.id, model]));
        const existingIds = new Set(current.map(node => node.id));
        // Retain layout and notes, even if an entry is temporarily absent.
        const updated = current.map(node => {
          const model = byId.get(node.id);
          if (node.type !== 'model' || !model) return node;
          return {
            ...node,
            data: {
              ...node.data,
              title: model.title || model.id,
              image: model.image,
              results: model.results
            }
          };
        });
        return [
          ...updated,
          ...catalog.filter(model => !existingIds.has(model.id)).map(createModelNode)
        ];
      });
    } catch (error) {
      setLibraryError(error.message);
    } finally {
      refreshPending.current = false;
      setRefreshingLibrary(false);
    }
  }

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
    setNodes(change.nodes);
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
      <article className={'library-card' + (isStack ? ' library-stack' : '')} key={node.id}
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
    setComparisonIds(current => current.filter(id => id !== nodeId));
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
    if (!nodeId || !flowInstance) return;
    event.preventDefault();
    activateModel(nodeId, flowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY
    }));
  }

  // ====================================================
  // Automatic local browser backup
  // ====================================================

  useEffect(() => {
    if (!modelsLoaded) {
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getCurrentLayout()));
    } catch {
      setLibraryError('Browser backup is unavailable. Use Save layout to keep your changes.');
    }
  }, [nodes, edges, modelsLoaded]);

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
        width: 230,
        height: 150,
        data: {
          title: 'Finding',
          text: ''
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
      current.filter(id => id !== nodeId)
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

  function toggleComparisonModel(nodeId) {
    setComparisonIds(current => {
      if (current.includes(nodeId)) {
        return current.filter(id => id !== nodeId);
      }

      if (current.length >= 3) {
        alert('You can compare up to three models at a time.');
        return current;
      }

      return [...current, nodeId];
    });

    setContextMenu(null);
  }

  function clearComparison() {
    setComparisonIds([]);
    setComparisonWindow(null);
  }

  async function openComparison(view = 'overview') {
    if (comparisonIds.length < 2) {
      alert('Select at least two models to compare.');
      return;
    }

    const selectedNodes = comparisonIds
      .map(id => nodes.find(node => node.id === id))
      .filter(node => node?.type === 'model');

    setComparisonWindow({
      view,
      loading: true,
      error: null,
      models: selectedNodes.map(node => ({
        id: node.id,
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

          return {
            id: node.id,
            title: node.data.title,
            data: await response.json()
          };
        })
      );

      setComparisonWindow(current => ({
        ...current,
        models: loadedModels,
        loading: false
      }));
    } catch (error) {
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
      if (event.target.closest('input, textarea')) {
        return;
      }

      event.preventDefault();

      const menuWidth = 230;
      const menuHeight = node.type === 'note' ? 100 : 580;

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

  async function openResults(nodeId, view) {
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

      const data = await response.json();

      setResultWindow(current => ({
        ...current,
        data,
        loading: false
      }));
    } catch (error) {
      setResultWindow(current => ({
        ...current,
        loading: false,
        error: error.message
      }));
    }
  }

  // ====================================================
  // Apply layout.json
  // ====================================================

  function applyLayout(layout) {
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
      throw new Error('The layout file must contain a JSON object.');
    }
    setComparisonIds([]);
    setContextMenu(null);
    const positions = getModelPositions(layout);
    const usedModels = getUsedModelIds(layout);

    const hiddenModels = new Set(
      Array.isArray(layout.hidden_models)
        ? layout.hidden_models
        : []
    );

    setNodes(currentNodes => {
      const modelNodes = currentNodes
        .filter(node => node.type === 'model')
        .map(node => ({
          ...node,
          position: positions[node.id] ?? node.position,
          hidden: usedModels.has(node.id) && hiddenModels.has(node.id),
          selected: false,
          data: {
            ...node.data,
            stackId: null,
            inUse: usedModels.has(node.id),
            hasPosition: Boolean(positions[node.id]) || node.data.hasPosition
          }
        }));

      const noteNodes = Array.isArray(layout.notes)
        ? layout.notes.map(normalizeNote)
        : [];

      return [
        ...restoreStacks(modelNodes, layout.stacks),
        ...noteNodes
      ];
    });

    setEdges(
      Array.isArray(layout.edges)
        ? layout.edges
        : []
    );
  }

  // ====================================================
  // Open permanent layout file
  // ====================================================

  async function openLayoutFile() {
    if (!window.showOpenFilePicker) {
      alert('Use Chrome or Edge for direct file editing.');
      return;
    }

    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'JSON files',
            accept: {
              'application/json': ['.json']
            }
          }
        ],
        multiple: false
      });

      const file = await handle.getFile();
      const text = await file.text();
      const layout = JSON.parse(text);

      applyLayout(layout);
      setLayoutHandle(handle);
    } catch (error) {
      if (error.name !== 'AbortError') {
        alert(`Could not open layout: ${error.message}`);
      }
    }
  }

  // ====================================================
  // Save layout
  // ====================================================

  async function saveLayout() {
    if (savePending.current) return;
    savePending.current = true;
    setSavingLayout(true);

    try {
      // Snapshot the current canvas before the picker opens. Choosing a file
      // for saving must never read or apply its existing contents.
      const contents = JSON.stringify(getCurrentLayout(), null, 2);
      let handle = layoutHandle;

      if (!handle) {
        const types = [{
          description: 'Layout JSON',
          accept: { 'application/json': ['.json'] }
        }];
        if (window.showSaveFilePicker) {
          handle = await window.showSaveFilePicker({
            suggestedName: 'layout.json',
            types
          });
        } else if (window.showOpenFilePicker) {
          // Fallback: select an existing destination, without reading it.
          [handle] = await window.showOpenFilePicker({ types, multiple: false });
        } else {
          alert('Use Chrome or Edge to save directly to a layout file.');
          return;
        }
      }

      const writable = await handle.createWritable();
      try {
        await writable.write(contents);
        await writable.close();
      } catch (error) {
        // Discard a failed partial write when the browser supports abort.
        try { await writable.abort(); } catch { /* Preserve the original error. */ }
        throw error;
      }
      setLayoutHandle(handle);
      alert('Layout saved.');
    } catch (error) {
      if (error.name !== 'AbortError') {
        alert('Could not save layout: ' + error.message);
      }
    } finally {
      savePending.current = false;
      setSavingLayout(false);
    }
  }

  // ====================================================
  // Hidden edges
  // ====================================================

  // Keep unused models in state so their positions and connections survive.
  // Only the rendered copy uses hidden for library membership.
  const renderedNodes = displayVersionNodes(nodes);
  const hiddenIds = new Set(
    renderedNodes
      .filter(node => node.hidden)
      .map(node => node.id)
  );

  const renderedEdges = edges.map(edge => ({
    ...edge,
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
  const libraryItems = nodes.filter(node => node.type !== 'note' && !node.data.stackId);
  const matchesItem = node => matchesQuery(node) || (node.type === 'stack' && node.data.memberIds.some(id => {
    const model = nodes.find(item => item.id === id);
    return model && matchesQuery(model);
  }));
  const availableModels = libraryItems.filter(node => !node.data.inUse);
  const usedModels = libraryItems.filter(node => node.data.inUse);
  const menuNode = nodes.find(node => node.id === contextMenu?.nodeId);
  const menuModelId = menuNode?.type === 'stack' ? menuNode.data.activeId : menuNode?.id;

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
        <div className="layout-toolbar">
          <button onClick={addNote} disabled={!modelsLoaded}>
            + Note
          </button>

          <button onClick={openLayoutFile} disabled={!modelsLoaded || savingLayout}
            title="Replace the current canvas with a saved layout">
            Load layout
          </button>

          <button onClick={saveLayout} disabled={!modelsLoaded || savingLayout}
            title="Save the current layout without loading or changing the canvas">
            {savingLayout ? 'Saving…' : 'Save layout'}
          </button>

          <button
            className={comparisonIds.length >= 2 ? 'compare-ready' : ''}
            onClick={() => openComparison('overview')}
            disabled={comparisonIds.length < 2}
            title="Right-click models to add them to the comparison"
          >
            Compare ({comparisonIds.length})
          </button>

          {comparisonIds.length > 0 && (
            <button onClick={clearComparison}>
              Clear comparison
            </button>
          )}

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
        </div>

        <ReactFlow
          nodes={renderedNodes}
          edges={renderedEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onInit={setFlowInstance}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={() => setContextMenu(null)}
          deleteKeyCode={stackDialog ? null : ['Backspace', 'Delete']}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      {libraryOpen && (
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
          {!modelsLoaded && !libraryError && <p role="status">Loading models…</p>}
          <div className="library-sections">
            {[
              ['Available', availableModels],
              ['In use', usedModels]
            ].map(([label, items]) => (
              <section className="library-section" key={label}>
                <h3>{label} <span>{items.length}</span></h3>
                {items.filter(matchesItem).map(renderLibraryItem)}
                {items.filter(matchesItem).length === 0 && (
                  <p className="library-empty">
                    {query ? 'No matching models.' : label === 'Available'
                      ? 'No unused models. Refresh after adding models to the catalog.'
                      : 'Choose a model from Available to begin.'}
                  </p>
                )}
              </section>
            ))}
          </div>
        </aside>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{
            left: contextMenu.x,
            top: contextMenu.y
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
              {RESULT_VIEWS.map(([key, label]) => (
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

              <button
                className={
                  comparisonIds.includes(menuModelId)
                    ? 'comparison-selected'
                    : ''
                }
                onClick={() =>
                  toggleComparisonModel(menuModelId)
                }
              >
                {comparisonIds.includes(menuModelId)
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
            <button
              className="danger"
              onClick={() => deleteNote(contextMenu.nodeId)}
            >
              Delete note
            </button>
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
      {/* Single-model results */}
      <ResultWindow
        windowData={resultWindow}
        onClose={() => setResultWindow(null)}
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
        onClose={() => setComparisonWindow(null)}
        onChangeView={view =>
          setComparisonWindow(current => ({
            ...current,
            view
          }))
        }
      />
    </div>
  );
}
