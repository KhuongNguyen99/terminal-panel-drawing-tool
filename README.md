# Wirebench

A browser-based wiring editor built from the supplied DQ, AI, AI RTD, AQ, Ex-AI, DIN resistor terminal, and 20-row DIN terminal block references. No backend or third-party browser libraries are required.

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

**DIN Resistor Rail Terminal Block** is available in the module library. It uses the approved flat image of ten upright terminals with exactly 20 connection points: ten along the top and ten along the bottom, numbered left to right. Each point branches to the two circular wire holes at that end of its terminal. Select the block and edit **Top row name** and **Bottom row name** in Properties; labels use `name.number`, starting with **TB10.1–TB10.10** and **TB11.1–TB11.10**. Row names persist in saved projects and can change without disconnecting or rerouting wires. Either row can connect to cable conductors or another module. The two rows are neutral connector identifiers; they do not assign polarity or a resistor value. The earlier standalone single-terminal SVGs remain in `assets/din-resistor-terminal/`.

Browser autosaves are stored on each browser and origin. This repository includes the default populated schedule; to transfer later personal edits between the hosted app and a local copy, use **Save project**, then **Open** the resulting `.wirebench.json` file.

## Using the editor

**DIN Solenoid Rail Terminal Block** adds the approved 20-row bank with 80 independent connection points. Every row has two mirrored three-column sections. On each side, the upper connector has a white arrow to the inner gray port; the lower connector has a black arrow to the middle gray port. Both arrow colors have bold black borders around their shafts and arrowheads. The yellow end terminals remain part of the hardware artwork. Arrows stay inside their row. Each side’s connector pair shares the row name, **S1–S20** from top to bottom, shown in red beside the dots between the white and black arrows. Both sides of a row use the same name in the canvas, Properties, and PNG exports. A translucent red shell surrounds each connector pair, with the wires, dots, and name drawn in front. The black connector is 10 units below the white connector, one 10-unit grid step above its previous position. Cable endpoints and arrow shafts follow it; physical arrow targets remain on the same terminals. Routing keeps these close connections in separate lanes even when component snapping uses a coarser grid. Properties shows the inner/middle connection status for each side of all 20 rows. The module works with cable labels, wire labels, connector tags, and other modules, and appears in individual PNG previews and batch ZIP exports. Saved modules using the previous default name, DIN Rail Terminal Block, adopt the new name when reopened; custom names remain intact.

1. Add an I/O module or DIN terminal block and a 2-wire or 4-wire cable from the library.
2. Select a device to edit its name and cable number, put the number on either side, or change which edge its wires leave from.
   Set its **Width** and **Height** in Properties, or drag its right, bottom, or bottom-right resize handle. Dragging follows the grid when Snap is on. Names reflow inside the resized label, conductors follow its edges, and connected wire endpoints follow the label. **Reset size** restores the original dimensions. Custom sizes are saved in the editable project and used in PNG exports.
3. Click a device conductor, then a module channel port. Dragging from a conductor to a port also works. Ports snap at the outside of the channel labels or at the terminal bank's connection dots. DIN connectors also accept wires from other I/O modules or terminal blocks. Wires leave the resistor bank upward or downward, and the 20-row terminal bank leftward or rightward.
4. Move modules and devices on the canvas. **Auto-route is off by default**: existing paths stay fixed, and only wires attached to a moved component update their endpoints. New connections receive an initial path around fixed wires and component rectangles. Bridges distinguish crossings.
5. Click a wire to change its color or thickness, reconnect it, or delete it. Changing a device conductor's color updates its connected wire.
   Drag any wire segment or its square handle to move that section perpendicular to its direction. Horizontal sections move up/down; vertical sections move left/right. The wire inspector also provides a segment selector and exact X/Y position. Arrow keys nudge a focused segment handle; Shift moves five steps. Snap uses the canvas grid. End sections add bends to keep their ports attached. Each move is one undo step; Escape cancels a drag. Manual routes persist through save/open and export, and moving a component updates its wire endpoints. Moving a segment always keeps every other wire path fixed, including when live auto-routing is enabled. A position that would block a connection or overlap a component is rejected. **Auto-route this wire** finds a new path for only the selected connection. **Auto-route all** replaces every path, including manual edits, in one undoable step. Turn on the **Auto-route** checkbox for automatic recalculation while arranging components; manually edited wires remain fixed. Turn it off to freeze the current layout again. Moving an obstruction over a fixed path keeps that path visible with a warning so you can adjust it.
6. Export a transparent PNG at 1×–4× resolution. Choose **Single PNG** and select any module or **Entire canvas**, or choose **All modules as ZIP**. ZIP export creates one PNG for every module, including unwired modules, with its local devices, wire labels, tags, and connections. Each image uses the selected resolution, padding, background, and title options. Files are numbered and named by RIO/location, slot, and module type so duplicate names stay distinct. The image excludes the editor, grid, selections, and interactive port handles. White wires have a thin neutral outline for visibility.

In **Single PNG** mode, the export dialog previews the selected module and its connections, or the entire canvas. The preview updates when you change the module, padding, background, or title and displays the final PNG dimensions for the chosen resolution. Use **+ / −** to zoom, scroll to inspect details, and **Fit** to see the whole image. Checkerboard areas are transparent. The preview and the download use the same drawing and bounds.

Projects autosave in browser-local storage. **Save project** downloads an editable `.wirebench.json` file; **Open** restores it. Saved paths and the routing preference persist through reload, save/open, and Undo/Redo; PNG export preserves the visible layout. Keeping a project file is the portable backup across browsers or devices.

All device labels use **210 × 60 px** by default, including four-wire cables. Existing saved projects receive this requested size once when opened; later manual size changes remain editable and persist. Four-wire conductors use separate, non-overlapping hit areas within the compact label.

Four-wire cables use **red, black, white, green** from top to bottom. Older saved projects receive this color-order update once when opened: the third and fourth conductors and their connected wires receive the new default colors while retaining their physical endpoints, module connections, and saved paths. Custom colors stay with their existing physical conductors. Two-wire cables continue to use black and white.

## Wire labels

Click **Wire label** in the library’s **Labels** section to add a name to a continuous wire. Each label displays only its name and has one connection point on the left and one on the right, with no cable number or additional conductors.

Connect **cable conductor → wire label → channel** by wiring the conductor to the label’s left dot and the right dot to the channel. Both segments follow the cable conductor’s color. Changing the color of the cable conductor or either connected segment updates the entire continuous connection. Labels can be chained: connect one label’s right dot to the next label’s left dot before continuing to the channel.

Wire labels start at **210 × 60 px**. Edit the name and dimensions in Properties, drag the label to move it, or use its resize handles. Connected wire endpoints follow the label. Wire labels support Copy/Paste with device labels and connector tags, and their names, sizes, and positions persist in saved projects and PNG exports.

## Copy and paste labels and tags

Select a device label, wire label, or connector tag on the canvas, then use **Copy** and **Paste** in the top toolbar, or **Ctrl+C / Ctrl+V** on Windows and Linux and **Cmd+C / Cmd+V** on macOS. Use **Shift+click** to add more labels or tags to the selection and copy them as a group. A selection rectangle also works.

Copies preserve names, custom width and height, and applicable color and side settings. Device labels also retain their cable numbers and two-wire or four-wire configuration. Pasted items are separate editable copies, ready to wire; their existing wires are not copied. A pasted tag retains its name, so it belongs to the same matching-name connection group until renamed.

**Copy** becomes available when the selection contains a device label, wire label, or connector tag. **Paste** remains available for pasting labels and tags from the clipboard. Normal text copying and pasting still works while editing a name or another text field.

## Connector tags

Connector tags represent a connection between separate areas of the drawing while keeping the visible wires short.

1. Click **Connector tag** in the component library. Select it and edit **Tag name** in Properties.
2. Choose **Connection side**: left, right, top, or bottom. Wire the tag's single connector dot to a device conductor or a module terminal, then move the tag near that endpoint.
3. Click **Add matching tag**, move the new tag near the other endpoint, and connect it with another short wire. Tags with matching names represent the same virtual connection; a long wire is not drawn between them.
4. Select a tag and click an entry in its matching-tags list in Properties to jump to the other location.

Set a selected tag's **Width** and **Height** in Properties, or drag its right, bottom, or bottom-right resize handle. The connector follows the selected edge, and connected wires stay attached. Resize handles follow the grid when Snap is on; arrow keys nudge a focused handle and Escape cancels a drag. **Reset size** restores **160 × 40 px**. Each tag has its own size; **Add matching tag** and Duplicate copy the selected tag's dimensions. Width accepts 80–1000 px and height accepts 30–600 px.

Names match after trimming leading/trailing spaces and ignoring letter case: `Pressure`, `PRESSURE`, and ` pressure ` belong to the same group. Keep different connections under different names. Tag positions, sizes, connection sides, names, and their local wires are saved with the project, restored on reopen, and included in PNG export.

To shorten an existing long wire, select it and click **Replace with tags**. The editor creates a pair with an unused name such as `NET1` and two short local wires, preserving the original wire's color and thickness. You can rename both tags afterward using the same name. One **Undo** immediately restores the original wire. The conversion keeps other wire paths fixed and is rejected if a new tag would block a new connection or a previously clear wire. Wires already ending at a tag use the normal tag and wire controls instead of this conversion.

Focusing a module or exporting the current slot includes tags wired directly to that module and tags wired to its included devices, so local short wires remain complete. Matching tags elsewhere on the canvas do not pull their remote modules or devices into that scoped drawing. Export the entire diagram to include all locations.

## Populated RIO schedule

**Full RIO schedule** opens `?project=rio-schedule` in its own autosaved workspace, preserving the previous project. The supplied sheets are populated as 22 modules, 100 physical channels, 56 device labels, and 44 spares. All 26 handwritten cable numbers are included; the other 30 assigned device labels have blank cable numbers. The default for a new browser with no saved work is also the complete schedule.

Use **Jump to** to focus a RIO and slot; the device list follows that slot. The module inspector lists every channel, its source tag, device and cable number, or spare status. Device inspectors retain their source channel assignments even when their conductors are not wired yet. PNG export offers the current slot, the entire diagram, or one PNG per module in a single ZIP download.

The project contains 82 wires based on the supplied convention: black to negative and white to positive for two-wire AI inputs, plus the white DQ signal leads. Seven RTD labels have four conductors awaiting the color-to-M+/M−/I+/I− mapping; 16 DQ black returns are ready for manual connection to the individual 0V terminals. Four-channel AI groups use the AI RTD reference and two-channel AI groups use the Ex-AI reference based on channel count and device names; the sheet itself labels both as AI. Spare groups follow the same template convention. No AQ assignments appear in the schedule.

The 24 `.wire_ok` rows are status metadata, not extra physical channels. Eight duplicate blank RIO A Slot 5 rows are merged with the populated rows. The Slot column remains 5 and the eight tags are corrected to `rioa.slot5.ai0` through `rioa.slot5.ai7`. **Source notes** in the editor records these choices.

## Controls

- Drag an item to move it. Shift-click or drag a selection rectangle to select several items.
- Scroll to zoom; hold Space and drag to pan. `V` selects the move tool; `H` selects pan.
- Arrow keys move selected items by one grid step; Shift+arrow moves five steps.
- `Delete` removes the selection. `Ctrl/Cmd+Z` undoes; `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` redoes.
- `Ctrl/Cmd+C` copies selected device labels, wire labels, and connector tags; `Ctrl/Cmd+V` pastes ready-to-wire copies. The **Copy** and **Paste** toolbar buttons perform the same actions. Shift-click to copy a group.
- `Ctrl/Cmd+D` duplicates the selection without copying external connections.
- `Ctrl/Cmd+S` saves a project file. `F` fits the board.

## Routing and reference boundaries

The deterministic Manhattan router avoids component rectangles, reserved terminal escape lanes, overlapping collinear segments, and tightly aligned parallel routes. It first looks for crossing-free routes; when crossings are unavoidable it supplies explicit bridge positions. If a component covers a terminal or obstructs a fixed path, the editor marks the wire as blocked and asks for more room. Existing fixed paths remain visible with a warning rather than silently shifting other wires. PNG export does not silently omit a blocked connection.

The app is a manual diagram editor. It preserves the channel labels in the supplied references and does not infer electrical compatibility or signal assignments from wire colors. A module terminal accepts one conductor. DQ exposes eight individually connectable **0V** terminals beneath its eight positive output terminals: four on the left and four on the right. Each has its own connection dot and a bold red arrow to its terminal circle. Tooltips identify the side and position, while the canvas labels show only **0V**. Saved connections to the earlier single 0V point reopen on the left third 0V terminal at the same outer wire anchor.

Module image provenance and reconstruction details are in `ASSET_NOTES.md`. The five I/O module front views use scalable SVG artwork. The DIN resistor bank uses the approved 2384 × 2055 transparent PNG, and the 20-row solenoid terminal bank uses its approved 1140 × 1380 transparent PNG. The I/O modules and resistor bank retain bold red callout arrows; the solenoid terminal bank uses white and black arrows with bold black borders. All arrowheads point to the circular terminal coordinates. DIN titles sit above the hardware, and new wire paths avoid the title bars. All artwork is embedded into exported PNGs.

## Formatting labels together

Shift-click label boxes (or drag a selection around them), then use **Properties** to set their common **Width**, **Height**, **Font size**, or **Text width**. Different values appear as **Mixed** until you change that field. If modules are also selected, formatting applies to the selected labels only.

Text width is the horizontal width of the letters: **100%** is normal, lower values condense the text, and higher values expand it. These controls format the names on device labels, wire labels, and connector tags. **Reset text style** restores automatic font sizing and normal text width. Manual font sizes stay fixed, so enlarge the box if larger letters need more room. Formatting survives undo/redo, Save/Open, copying, and PNG export.

## Source

- `dist/app.js`: SVG editor interactions, inspector, persistence, and PNG export.
- `dist/model.js`: project validation, node geometry, and export bounds.
- `dist/router.js`: obstacle-aware orthogonal routing and crossing diagnostics.
- `dist/manual-routing.js`: movable wire segments, endpoint attachment, and saved manual paths.
- `dist/independent-routing.js`: fixed wire paths, optional live routing, and explicit single/all-wire rerouting.
- `dist/modules.js`: exact channel labels and reference-based module geometry.
- `dist/schedule.js`: deduplicated source schedule, populated labels, and known connections.
- `dist/schedule-navigation.js`: local slot grouping, including connector tags, for canvas navigation and exports.
- `dist/zip.js`: browser-local ZIP packaging for batch module PNG exports.
- `dist/assets/`: scalable module front views and their original raster references, with transparent exteriors.
- `dist/index.html`, `dist/styles.css`: responsive editor interface.

Run the focused model and routing checks with `npm test` and preview locally with `npm start`. Deployment configuration is in `.openai/hosting.json`.
