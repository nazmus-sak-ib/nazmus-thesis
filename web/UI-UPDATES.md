# Workspace controls

- Hover over a model or arrow's note icon for a formatted preview. Moving off
  the icon hides it; clicking opens the existing editor. Keyboard focus also
  previews notes. Long previews are clipped; open the editor to read everything.
- Drag a page in the sidebar to reorder it. A blue insertion line marks the
  destination. Page identities, contents, and the active page stay unchanged.
  Alt+Up/Down on a focused page button also reorders it. Save workspace preserves
  the order in the workspace file; browser autosave also remembers it.
- `* Unsaved changes` indicates differences from the last successful file save.
  Browser autosave does not clear it. Navigation, viewport movement, and newly
  discovered unused model size defaults are not document edits. If a save fails
  or is cancelled, the star remains. Edits made while a save is pending remain
  unsaved even when that earlier snapshot finishes saving. A download-only
  browser cannot confirm file-write success, so its marker stays visible.
- Context menus close on outside clicks, toolbar actions, and Escape. Controls
  inside a context menu continue working.
- The Comparison queue beside Compare lists selected model names and IDs.
  Remove individual entries with ×, use Clear all, or search for a model to add.
  Search includes unused and hidden models as well as individual stack versions.
  The existing five-model addition limit is unchanged. Edits to the queue update
  an already-open comparison; fewer than two entries close the comparison window.

Tests: `node --test tests/*.test.mjs`, `npm run build`, and `npm run lint` from web.
`node tests/preview-ui.mjs` provides a separate QA origin on port 5194 with
simulated successful/failed file writes; it never writes a real workspace file.
