# Undo, redo, and arrow connections

Open the canvas toolbar (☰) for **Undo** and **Redo**. Shortcuts are **Ctrl+Z**
and **Ctrl+Shift+Z** (or **Ctrl+Y**); Command works on macOS. When typing in a
text editor, these shortcuts use the editor's own text undo/redo.

Each page keeps its own history as you switch pages. Moving or resizing an item,
adjusting an arrow bend, or dragging a container with its contents is one step.
Typing is grouped into short bursts. Stacking, hiding, returning models to the
library, notes, connections, and shape styling are included. A new edit after
undo discards the redo branch.

History is session-only, capped at 60 steps and approximately 16 MB per page.
Reloading or opening a workspace clears history. If folder refresh changes the
available model IDs, the affected page's history resets when that page is loaded
with the changed library. Saving, file discovery, page creation/deletion,
viewport movement, and comparison selection are outside page history.

To reposition an arrow connection, drag the arrow near the end you want to move.
The closer endpoint is selected. Its original canvas item displays four snap
points; the proposed point is highlighted and the preview arrow is dashed.
Release near that item to attach, or release far away / press Escape to keep the
original connection. The endpoint cannot attach to another item. Notes, styles,
arrowheads, and bend settings remain attached to the same arrow. The diamond
handle still adjusts the bend independently.

Validation commands, from `web`:

```sh
node --test tests/history-and-arrows.test.mjs
npm run build
npm run lint
```

`node tests/preview-history.mjs` starts a browser test origin on port 5193, using
an initial test layout without modifying saved layout files or the normal
development origin's browser storage. Stop it with Ctrl+C when finished.
