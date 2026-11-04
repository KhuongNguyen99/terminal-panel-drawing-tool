# Wiring editor module references

The original PNG module bodies are deterministic crops of the images supplied by the user. The editor now displays SVG front-view reconstructions of those same bodies to keep outlines, terminal circles and readable markings sharp at every zoom. The SVGs preserve the original coordinate systems, sampled colors, nine terminal rows on the ET 200SP modules, four rows on Ex-AI, indicator layout, printed model identifiers and molded silhouette. Small unreadable factory/molded markings are retained as source-pixel vector traces; no missing lettering or new pin assignments are invented. These are reference-based diagram illustrations, not dimensional manufacturer CAD files. The original PNG crops remain available for comparison.

The five I/O SVGs contain transparent exteriors and retain enclosed white indicator windows. The original external callout-arrow remnants are removed so the editor draws only its current bold red channel arrows. These five I/O SVGs use deterministic reconstruction.

| Template | Source | Port interpretation |
|---|---|---|
| DQ | `image(20261031-181833).png` | Left CH0+, CH2+, CH4+, CH6+; right CH1+, CH3+, CH5+, CH7+. Per the user's editor request, the next four terminal rows expose eight separate connection points, each labeled `0V`. They are identified by side and row rather than assigned to output-channel numbers. |
| AI RTD | `image(20261031-181934).png` | Left channels 0/1 and right channels 2/3. Within each side: M+, M+, M−, M−, I+, I+, I−, I−. |
| AQ | `image(20261031-181959).png` | Left CH0+, CH0−; right CH1+, CH1−. |
| Ex-AI | `image(20261031-193634).png` | Left CH0−, CH0+; right CH1−, CH1+. Additional unannotated physical contacts are intentionally not assigned. |
| AI | Saved screenshot of the user's completed native Slot 5 Google Drawing | Left even channels and right odd channels, with negative rows above positive rows. This crop is lower resolution than the four newly uploaded images. |

Module nodes are 360 × 500 editor units. The connection points sit outside the channel labels at x=60 on the left and x=300 on the right, bringing the labels toward the module body. `port.y` uses a 10-unit grid (with 20-unit spacing for the eight-row groups), while `port.pinY` records the actual image contact row for the internal label-to-module arrow. `body.terminalLeft` and `body.terminalRight` identify the centers of the circular terminals. Red callout arrows use 3.5-unit shafts, begin eight units beside the rendered channel text, and end at these centers; their heads follow the shaft angle. The same geometry and SVG artwork are used for the editor and transparent PNG export.

Both SVGs and reference PNGs contain only the hardware body, not the live channel callouts, so exported canvas backgrounds remain transparent. SVG intrinsic dimensions are four times the source crop dimensions, while their viewBoxes retain the original coordinates; their vector content also scales beyond those dimensions.

DQ 0V arrows target the existing circles at source x=45/64 and y=387/406/425/444. Their outer connection dots sit at editor y=390/410/430/450, with four on each side. The final artwork row at source y=463 is unchanged. The left third 0V point retains the stored ID `common-0v` and its original outer coordinate so previously saved connections and wire routes stay attached; the displayed label is `0V`.

## Model markings checked against manufacturer references

- DQ: `6ES7132-6BF00-0CA0` — [Siemens equipment manual](https://cache.industry.siemens.com/dl/files/554/66912554/att_882661/v1/et200sp_dq_8x24vdc_0_5a_hf_manual_en-US_en-US.pdf).
- AI: `6ES7134-6GF00-0AA1` — [Siemens AI 8xI 2-/4-wire BA documentation](https://docs.tia.siemens.cloud/r/simatic_et_200sp_manual_collection_enus_20/device-specific-information/i/o-modules/analog-input-modules/analog-input-module-ai-8xi-2/4-wire-ba-6es7134-6gf00-0aa1/product-overview/properties).
- AI RTD: `6ES7134-6JD00-0CA1` — [Siemens RTD documentation](https://docs.tia.siemens.cloud/r/simatic_et_200sp_manual_collection_enus_20/device-specific-information/i/o-modules/analog-input-modules/analog-input-module-ai-4xrtd/tc-2/3/4-wire-hf-6es7134-6jd00-0ca1/product-overview/properties).
- AQ: `6ES7135-6HB00-0CA1`, as printed in the supplied reference; the indexed equipment manual identifies the same model.
- Ex-AI: `6DL1134-6TB00-0HX1` — [Siemens Ex-AI documentation](https://docs.tia.siemens.cloud/r/simatic_et_200sp_manual_collection_itit_20/device-specific-information/i/o-modules/et-200sp-ha-ex-module/ex-ai-2xi-2-wire-hart/product-overview/properties-of-the-i/o-module-ex-ai-2xi-2-wire-hart?contentId=_MVKef1JTtpjXiWPrbywQQ).

The available manufacturer product illustrations use perspective views without the user's terminal BaseUnits; they were used only to check readable markings, not substituted into the editor.

## Source files and asset tooling

The complete supplied module images, source schedule photos, saved Slot 5 drawing view, and cabinet photo are retained in `docs/references/`. The original transparent module crops remain in `dist/assets/`.

Portable copies of the DQ/AI RTD and AQ/Ex-AI SVG reconstruction scripts are in `tools/assets/`; that directory documents their optional Python dependencies and font configuration. The AI SVG and DIN terminal SVG are maintained directly as vector source. None of these scripts are needed to run the editor.

## Standalone DIN resistor terminal

`assets/din-resistor-terminal/` contains two standalone illustrations, each supplied as an editable SVG and a transparent PNG:

- `din-resistor-terminal-top-view`: the horizontal assembly reconstructed from the clear reference in `docs/references/din-resistor-terminal-top-view.png`, with four wire openings, four orange releases, two oval recesses, and the central three-banded resistor. The SVG uses a 1920 × 224 viewBox and the PNG is 3840 × 448 px.
- `din-resistor-terminal-block`: the earlier vertical front view reconstructed from the cabinet photograph.

Both single-terminal assets use flat vector shapes with transparent exteriors. They remain separate from the connected ten-terminal bank in the editor.

## DIN Resistor Rail Terminal Block

`dist/assets/module-din-resistor.png` is the approved 2384 × 2055 transparent bank image. It contains ten pixel-identical copies of the approved flat terminal illustration, rotated upright. The `DIN_RESISTOR` editor template uses a 640 × 650 body with proportional artwork and exactly two external connector rows, both numbered left to right. Their independently editable names default to TB10 and TB11, giving labels TB10.1–TB10.10 and TB11.1–TB11.10. Each logical connection point represents both circular wire holes at that end of a physical terminal; the paired holes do not add more interactive connectors.

The module artwork scale is 60/232, matching its 232-pixel column pitch to a 60-unit connector pitch. External connector dots stay at x=50+60i and y=0/650. Paired red arrows aim at source x≈162+232i: top hole rows y≈194.5/443.8 and bottom hole rows y≈1859.2/1609.3. Each inner-hole branch uses the clear lane at editor x=75+60i beside its terminal. The title bar is above the complete block at local y=-100 with height32, and is a separate routing obstruction so outward wires route around it. The PNG is embedded into exports without an opaque background.

Connections can run from either row to a cable conductor or to another module. These are neutral terminal identifiers; the editor does not infer polarity, internal circuit behavior, or a resistor value from the artwork.

## DIN Solenoid Rail Terminal Block — 20 rows

`dist/assets/module-din-terminal.png` is a byte-identical copy of the user's approved 1140 × 1380 transparent drawing. The drawing was generated from the supplied cabinet photograph with the wires removed, then corrected and approved to show exactly 20 complete rows, with a yellow connection at each end of every row. It is a visual reference, not manufacturer CAD.

The `DIN_TERMINAL` template preserves that artwork and adds 80 independently connectable ports: two vertically stacked points on the left and two on the right for each row. Columns 1–3 form the left section and columns 4–6 the right. Left upper/white arrows target column 3; left lower/black arrows target column 2. Right upper/white arrows target column 4; right lower/black arrows target column 5. Yellow end columns have no external arrow assignment in this layout. The source image contains no arrow or text overlay.

The 860 × 960 template scales the source artwork by 40/58. External dots use x=40/820 and y=140/160+40i, keeping all endpoints on the routing grid with 20-unit spacing. Their 8-unit hit areas remain separate. Arrowheads use measured circular-port centers from the approved image, while the outer dots retain exact grid coordinates. Both arrows fit within their physical row, including the first and last rows. White and black shafts retain the approved thicker first-row preview's 4.5-unit width and 12 × 10.4 arrowhead dimensions. Both use a bold black (#000000) border: a 10.5-unit shaft underlay and a 3-unit arrowhead stroke, all scaled with the artwork. The header sits above the hardware at y=-52 and is a separate routing obstacle.

The canvas shows the arrow pairs and connection dots without color-name labels. Accessible port names and the Properties row-status list identify row, side, and inner/middle position. The editor, live PNG preview, individual PNG, and ZIP exports share the same arrow renderer. Saved modules using the former default name, DIN Rail Terminal Block, update to DIN Solenoid Rail Terminal Block on load; custom names and connector IDs are retained. No electrical continuity is inferred between these separate logical ports.
