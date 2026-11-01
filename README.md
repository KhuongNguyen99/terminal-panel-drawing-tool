# Wirebench

A browser-based wiring editor built from the supplied DQ, AI, AI RTD, AQ, and Ex-AI module references. No backend or third-party browser libraries are required.

## Run locally

Install Node.js 18 or newer, then run these commands from a terminal:

```sh
git clone https://github.com/KhuongNguyen99/terminal-panel-drawing-tool.git
cd terminal-panel-drawing-tool
npm start
```

Open **http://127.0.0.1:5173**. The complete RIO schedule is also available at **http://127.0.0.1:5173/?project=rio-schedule**. There are no npm dependencies to install and no build step: `dist/` contains the editable application source and static assets. Use `npm start -- 8080` to select another port. Stop the local server with Ctrl+C.

Run the existing checks with `npm test`. For hosting, serve the contents of `dist/` from any static HTTP server. The included Node server is for local editing and preview.

## Included project files

- `dist/`: complete editor, routing logic, schedule, styles, and module SVG/PNG assets.
- `tests/`: model, routing, manual-segment, independent-wire, schedule, and navigation checks.
- `data/rio-cable-schedule.csv`: the corrected 132-row source transcription, including handwritten cable numbers and RIO A Slot 5 tag corrections.
- `examples/rio-schedule.wirebench.json`: an editable copy of the default populated schedule, loadable with **Open**.
- `assets/din-resistor-terminal/`: the standalone terminal-block SVG and transparent high-resolution PNG.
- `docs/references/`: original schedule photos, module references, and terminal-block reference photo.
- `tools/assets/`: optional Python scripts used to reconstruct four of the module SVGs.
- `ASSET_NOTES.md`: artwork provenance and channel geometry.
- `.openai/hosting.json`: configuration for the existing Wirebench Site.

The DIN resistor terminal is supplied as standalone artwork; it has not yet been added as a connectable module in the editor. Its illustration is based on the supplied cabinet photo and does not establish an exact manufacturer part number or resistor value.

Browser autosaves are stored on each browser and origin. This repository includes the default populated schedule; to transfer later personal edits between the hosted app and a local copy, use **Save project**, then **Open** the resulting `.wirebench.json` file.

## Using the editor

1. Add an I/O module and a 2-wire or 4-wire device from the library.
2. Select a device to edit its name and cable number, put the number on either side, or change which edge its wires leave from.
   Set its **Width** and **Height** in Properties, or drag its right, bottom, or bottom-right resize handle. Dragging follows the grid when Snap is on. Names reflow inside the resized label, conductors follow its edges, and connected wire endpoints follow the label. **Reset size** restores the original dimensions. Custom sizes are saved in the editable project and used in PNG exports.
3. Click a device conductor, then a module channel port. Dragging from a conductor to a port also works. Ports snap at the outside of the channel labels.
4. Move modules and devices on the canvas. **Auto-route is off by default**: existing paths stay fixed, and only wires attached to a moved component update their endpoints. New connections receive an initial path around fixed wires and component rectangles. Bridges distinguish crossings.
5. Click a wire to change its color or thickness, reconnect it, or delete it. Changing a device conductor's color updates its connected wire.
   Drag any wire segment or its square handle to move that section perpendicular to its direction. Horizontal sections move up/down; vertical sections move left/right. The wire inspector also provides a segment selector and exact X/Y position. Arrow keys nudge a focused segment handle; Shift moves five steps. Snap uses the canvas grid. End sections add bends to keep their ports attached. Each move is one undo step; Escape cancels a drag. Manual routes persist through save/open and export, and moving a component updates its wire endpoints. Moving a segment always keeps every other wire path fixed, including when live auto-routing is enabled. A position that would block a connection or overlap a component is rejected. **Auto-route this wire** finds a new path for only the selected connection. **Auto-route all** replaces every path, including manual edits, in one undoable step. Turn on the **Auto-route** checkbox for automatic recalculation while arranging components; manually edited wires remain fixed. Turn it off to freeze the current layout again. Moving an obstruction over a fixed path keeps that path visible with a warning so you can adjust it.
6. Export a transparent PNG at 1×–4× resolution. The image excludes the editor, grid, selections, and interactive port handles. White wires have a thin neutral outline for visibility.

Projects autosave in browser-local storage. **Save project** downloads an editable `.wirebench.json` file; **Open** restores it. Saved paths and the routing preference persist through reload, save/open, and Undo/Redo; PNG export preserves the visible layout. Keeping a project file is the portable backup across browsers or devices.

All device labels use **210 × 60 px** by default, including four-wire cables. Existing saved projects receive this requested size once when opened; later manual size changes remain editable and persist. Four-wire conductors use separate, non-overlapping hit areas within the compact label.

## Populated RIO schedule

**Full RIO schedule** opens `?project=rio-schedule` in its own autosaved workspace, preserving the previous project. The supplied sheets are populated as 22 modules, 100 physical channels, 56 device labels, and 44 spares. All 26 handwritten cable numbers are included; the other 30 assigned device labels have blank cable numbers. The default for a new browser with no saved work is also the complete schedule.

Use **Jump to** to focus a RIO and slot; the device list follows that slot. The module inspector lists every channel, its source tag, device and cable number, or spare status. Device inspectors retain their source channel assignments even when their conductors are not wired yet. PNG export offers the current slot or the entire diagram.

The project contains 82 wires based on the supplied convention: black to negative and white to positive for two-wire AI inputs, plus the white DQ signal leads. Seven RTD labels have four conductors awaiting the color-to-M+/M−/I+/I− mapping; 16 DQ black returns await an identified common termination. Neither mapping is invented. Four-channel AI groups use the AI RTD reference and two-channel AI groups use the Ex-AI reference based on channel count and device names; the sheet itself labels both as AI. Spare groups follow the same template convention. No AQ assignments appear in the schedule.

The 24 `.wire_ok` rows are status metadata, not extra physical channels. Eight duplicate blank RIO A Slot 5 rows are merged with the populated rows. The Slot column remains 5 and the eight tags are corrected to `rioa.slot5.ai0` through `rioa.slot5.ai7`. **Source notes** in the editor records these choices.

## Controls

- Drag an item to move it. Shift-click or drag a selection rectangle to select several items.
- Scroll to zoom; hold Space and drag to pan. `V` selects the move tool; `H` selects pan.
- Arrow keys move selected items by one grid step; Shift+arrow moves five steps.
- `Delete` removes the selection. `Ctrl/Cmd+Z` undoes; `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` redoes.
- `Ctrl/Cmd+D` duplicates the selection without copying external connections.
- `Ctrl/Cmd+S` saves a project file. `F` fits the board.

## Routing and reference boundaries

The deterministic Manhattan router avoids component rectangles, reserved terminal escape lanes, overlapping collinear segments, and tightly aligned parallel routes. It first looks for crossing-free routes; when crossings are unavoidable it supplies explicit bridge positions. If a component covers a terminal or obstructs a fixed path, the editor marks the wire as blocked and asks for more room. Existing fixed paths remain visible with a warning rather than silently shifting other wires. PNG export does not silently omit a blocked connection.

The app is a manual diagram editor. It preserves the channel labels in the supplied references and does not infer electrical compatibility or signal assignments from wire colors. A module channel accepts one conductor. DQ exposes the single shared 0 V connection area shown in the source image; it does not invent individual common terminal numbers or an unshown shared-ground bus.

Module image provenance and reconstruction details are in `ASSET_NOTES.md`. All five module front views use scalable SVG artwork for sharp zoom and PNG export. The channel labels sit close to the module body, and bold red callout arrows point to the original circular terminal coordinates. The original raster crops are retained as source references.

## Source

- `dist/app.js`: SVG editor interactions, inspector, persistence, and PNG export.
- `dist/model.js`: project validation, node geometry, and export bounds.
- `dist/router.js`: obstacle-aware orthogonal routing and crossing diagnostics.
- `dist/manual-routing.js`: movable wire segments, endpoint attachment, and saved manual paths.
- `dist/independent-routing.js`: fixed wire paths, optional live routing, and explicit single/all-wire rerouting.
- `dist/modules.js`: exact channel labels and reference-based module geometry.
- `dist/schedule.js`: deduplicated source schedule, populated labels, and known connections.
- `dist/schedule-navigation.js`: slot grouping for canvas navigation and exports.
- `dist/assets/`: scalable module front views and their original raster references, with transparent exteriors.
- `dist/index.html`, `dist/styles.css`: responsive editor interface.

Run the focused model and routing checks with `npm test` and preview locally with `npm start`. Deployment configuration is in `.openai/hosting.json`.
