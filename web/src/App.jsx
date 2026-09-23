import {
  useCallback,
  useEffect,
  useState
} from 'react';

import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow
} from '@xyflow/react';

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
      <Handle
        id="target-top"
        type="target"
        position={Position.Top}
      />

      <Handle
        id="target-left"
        type="target"
        position={Position.Left}
      />

      <Handle
        id="source-right"
        type="source"
        position={Position.Right}
      />

      <Handle
        id="source-bottom"
        type="source"
        position={Position.Bottom}
      />
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

function NoteNode({ id, data }) {

  const { updateNodeData } = useReactFlow();

  return (
    <div className="note-node">

      <ConnectionHandles />

      <input
        className="note-title nodrag"
        value={data.title ?? ''}
        placeholder="Heading"
        onChange={(event) =>
          updateNodeData(id, {
            title: event.target.value
          })
        }
      />

      <textarea
        className="note-text nodrag nowheel"
        value={data.text ?? ''}
        placeholder="Type here..."
        onChange={(event) =>
          updateNodeData(id, {
            text: event.target.value
          })
        }
      />

    </div>
  );
}


const nodeTypes = {
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
// App
// ======================================================

export default function App() {

  const [nodes, setNodes, onNodesChange] =
    useNodesState([]);

  const [edges, setEdges, onEdgesChange] =
    useEdgesState([]);

  const [result, setResult] =
    useState(null);

  const [modelsLoaded, setModelsLoaded] =
    useState(false);

  const [layoutHandle, setLayoutHandle] =
    useState(null);

  const [flowInstance, setFlowInstance] =
    useState(null);


  // ====================================================
  // Helper: old + new layout formats
  // ====================================================

  function getModelPositions(layout) {

    if (!layout) return {};

    // New format
    if (layout.model_positions) {
      return layout.model_positions;
    }

    // Previous layout.json format
    if (layout.positions) {
      return layout.positions;
    }

    // Previous localStorage format
    if (!layout.schema_version) {
      return layout;
    }

    return {};
  }


  // ====================================================
  // Convert current canvas into savable JSON
  // ====================================================

  function getCurrentLayout() {

    const modelPositions = {};
    const notes = [];

    const round = value =>
      Math.round(value * 100) / 100;


    nodes.forEach(node => {

      const position = {
        x: round(node.position.x),
        y: round(node.position.y)
      };


      if (node.type === 'model') {

        modelPositions[node.id] =
          position;

      }


      if (node.type === 'note') {

        notes.push({
          id: node.id,

          type: 'note',

          position,

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
        saved.sourceHandle =
          edge.sourceHandle;
      }

      if (edge.targetHandle) {
        saved.targetHandle =
          edge.targetHandle;
      }


      return saved;
    });


    return {
      schema_version: '2.0',

      model_positions:
        modelPositions,

      notes,

      edges:
        savedEdges
    };
  }


  // ====================================================
  // Initial load
  // ====================================================

  useEffect(() => {

    async function loadEverything() {

      // -------------------------------
      // Model catalogue
      // -------------------------------

      const catalogResponse =
        await fetch(
          `${BASE}models.json`
        );

      const catalog =
        await catalogResponse.json();


      // -------------------------------
      // Browser backup
      // -------------------------------

      let browserLayout = {};

      try {

        browserLayout =
          JSON.parse(
            localStorage.getItem(
              STORAGE_KEY
            ) || '{}'
          );

      } catch {
        browserLayout = {};
      }


      // -------------------------------
      // Permanent layout.json
      // -------------------------------

      let fileLayout = {};

      try {

        const response =
          await fetch(
            `${BASE}layout.json`,
            {
              cache: 'no-store'
            }
          );

        if (response.ok) {
          fileLayout =
            await response.json();
        }

      } catch {
        fileLayout = {};
      }


      const filePositions =
        getModelPositions(
          fileLayout
        );

      const browserPositions =
        getModelPositions(
          browserLayout
        );


      // -------------------------------
      // Models
      // -------------------------------

      const modelNodes =
        catalog.models.map(
          (model, index) => {

            const defaultPosition = {
              x:
                100 +
                (index % 3) * 380,

              y:
                100 +
                Math.floor(
                  index / 3
                ) * 320
            };


            return {

              id: model.id,

              type: 'model',

              deletable: false,

              position:
                filePositions[
                  model.id
                ] ??
                browserPositions[
                  model.id
                ] ??
                defaultPosition,

              data: {
                title: model.title,
                image: model.image,
                results:
                  model.results
              }
            };
          }
        );


      // -------------------------------
      // Notes
      // -------------------------------

      let noteNodes = [];

      if (
        Array.isArray(
          fileLayout.notes
        )
      ) {

        noteNodes =
          fileLayout.notes;

      } else if (
        Array.isArray(
          browserLayout.notes
        )
      ) {

        noteNodes =
          browserLayout.notes;

      }


      // -------------------------------
      // Edges
      // -------------------------------

      let loadedEdges = [];

      if (
        Array.isArray(
          fileLayout.edges
        )
      ) {

        loadedEdges =
          fileLayout.edges;

      } else if (
        Array.isArray(
          browserLayout.edges
        )
      ) {

        loadedEdges =
          browserLayout.edges;

      }


      setNodes([
        ...modelNodes,
        ...noteNodes
      ]);

      setEdges(
        loadedEdges
      );

      setModelsLoaded(true);
    }


    loadEverything();

  }, [setNodes, setEdges]);


  // ====================================================
  // Automatic browser backup
  // ====================================================

  useEffect(() => {

    if (!modelsLoaded) return;

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        getCurrentLayout()
      )
    );

  }, [
    nodes,
    edges,
    modelsLoaded
  ]);


  // ====================================================
  // Create arrow
  // ====================================================

  const onConnect =
    useCallback(
      connection => {

        setEdges(currentEdges =>
          addEdge(
            connection,
            currentEdges
          )
        );

      },
      [setEdges]
    );


  // ====================================================
  // Add editable note
  // ====================================================

  function addNote() {

    let position = {
      x: 200,
      y: 200
    };


    // Put new note approximately
    // in the center of what you're viewing
    if (flowInstance) {

      const canvas =
        document.querySelector(
          '.canvas'
        );

      if (canvas) {

        const bounds =
          canvas.getBoundingClientRect();

        position =
          flowInstance
            .screenToFlowPosition({
              x:
                bounds.left +
                bounds.width / 2 -
                110,

              y:
                bounds.top +
                bounds.height / 2 -
                70
            });
      }
    }


    const id =
      `note-${Date.now()}`;


    setNodes(current => [
      ...current,

      {
        id,

        type: 'note',

        position,

        data: {
          title: 'Finding',
          text: ''
        }
      }
    ]);
  }


  // ====================================================
  // Apply a selected layout.json
  // ====================================================

  function applyLayout(layout) {

    const positions =
      getModelPositions(layout);


    setNodes(currentNodes => {

      const modelNodes =
        currentNodes
          .filter(
            node =>
              node.type === 'model'
          )
          .map(node => ({

            ...node,

            position:
              positions[node.id] ??
              node.position

          }));


      const noteNodes =
        Array.isArray(layout.notes)
          ? layout.notes
          : currentNodes.filter(
              node =>
                node.type === 'note'
            );


      return [
        ...modelNodes,
        ...noteNodes
      ];

    });


    if (
      Array.isArray(layout.edges)
    ) {
      setEdges(layout.edges);
    }
  }


  // ====================================================
  // Open layout file
  // ====================================================

  async function openLayoutFile() {

    if (!window.showOpenFilePicker) {

      alert(
        'Use Chrome or Edge for direct file editing.'
      );

      return;
    }


    const [handle] =
      await window.showOpenFilePicker({

        types: [
          {
            description:
              'JSON files',

            accept: {
              'application/json':
                ['.json']
            }
          }
        ],

        multiple: false
      });


    setLayoutHandle(handle);


    const file =
      await handle.getFile();

    const text =
      await file.text();

    const layout =
      JSON.parse(text);


    applyLayout(layout);
  }


  // ====================================================
  // Save layout
  // ====================================================

  async function saveLayout() {

    if (!layoutHandle) {

      alert(
        'First click "Open layout file" and choose public/layout.json.'
      );

      return;
    }


    const writable =
      await layoutHandle
        .createWritable();


    await writable.write(
      JSON.stringify(
        getCurrentLayout(),
        null,
        2
      )
    );


    await writable.close();


    alert('Layout saved.');
  }


  // ====================================================
  // Click model → results
  // ====================================================

  async function handleNodeClick(
    event,
    node
  ) {

    if (
      node.type !== 'model'
    ) {
      return;
    }


    const response =
      await fetch(
        `${BASE}${node.data.results}`
      );

    const data =
      await response.json();


    setResult(data);
  }


  // ====================================================
  // Result helpers
  // ====================================================

  function fit(name) {

    return result
      ?.fit_measures
      ?.find(
        x =>
          x.measure === name
      )
      ?.value;
  }


  function r2(variable) {

    return result
      ?.r_squared
      ?.find(
        x =>
          x.variable === variable
      )
      ?.r2;
  }


  // ====================================================
  // Display
  // ====================================================

  return (

    <div className="app">


      <div className="canvas">


        <div className="layout-toolbar">

          <button
            onClick={addNote}
          >
            + Note
          </button>


          <button
            onClick={
              openLayoutFile
            }
          >
            Open layout file
          </button>


          <button
            onClick={saveLayout}
          >
            Save layout
          </button>

        </div>


        <ReactFlow

          nodes={nodes}

          edges={edges}

          onNodesChange={
            onNodesChange
          }

          onEdgesChange={
            onEdgesChange
          }

          onConnect={
            onConnect
          }

          nodeTypes={
            nodeTypes
          }

          defaultEdgeOptions={
            defaultEdgeOptions
          }

          onNodeClick={
            handleNodeClick
          }

          onInit={
            setFlowInstance
          }

          deleteKeyCode={[
            'Backspace',
            'Delete'
          ]}

          fitView

        >

          <Background />

          <Controls />

        </ReactFlow>

      </div>


      <aside className="results">

        {!result ? (

          <p>
            Click a model to see
            its results.
          </p>

        ) : (

          <>

            <h2>
              {
                result.metadata
                  .model_name
              }
            </h2>

            <p>
              <strong>
                Robust CFI:
              </strong>{' '}
              {fit('cfi.robust')}
            </p>

            <p>
              <strong>
                Robust TLI:
              </strong>{' '}
              {fit('tli.robust')}
            </p>

            <p>
              <strong>
                Robust RMSEA:
              </strong>{' '}
              {fit(
                'rmsea.robust'
              )}
            </p>

            <p>
              <strong>
                SRMR:
              </strong>{' '}
              {fit('srmr')}
            </p>

            <p>
              <strong>
                Intention R²:
              </strong>{' '}
              {r2('Intention')}
            </p>

          </>

        )}

      </aside>

    </div>
  );
}