# Optional module artwork generators

These Python scripts preserve the construction source for four of Wirebench's
module illustrations. They are **not required to run or deploy the editor**:
the finished SVGs and reference PNG crops are already committed in `dist/assets/`.

All paths are resolved from each script's location, so the scripts can be run
from any working directory. Regeneration writes the corresponding canonical
SVG files in `dist/assets/`; review the resulting Git diff before committing.
The source PNGs are read without modification.

## Setup

Use Python 3.10 or newer. From the repository root:

```sh
python -m venv .venv
```

Activate the environment with `source .venv/bin/activate` on macOS/Linux or
`.venv\Scripts\Activate.ps1` in Windows PowerShell, then install the optional
dependencies:

```sh
python -m pip install -r tools/assets/requirements.txt
```

The requirements record the versions used to verify regeneration:
Pillow reads source crops and creates comparison sheets; fontTools converts
DQ/RTD text to outlines; PyMuPDF renders the DQ/RTD SVG previews. The browser
application has none of these Python dependencies.

## DQ and AI RTD

```sh
python tools/assets/rebuild_dq_rtd_assets.py
```

This reads `module-dq.png` and `module-ai-rtd.png`, regenerates the corresponding
SVGs, and writes diagnostic raster previews and source/vector comparisons to
`build/asset-previews/`. That build directory is disposable and ignored by Git.

The script outlines text using **DejaVu Sans**. By default it looks for
`/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`. On other systems, set
`WIREBENCH_FONT` to the local font file before running it:

```sh
WIREBENCH_FONT=/path/to/DejaVuSans.ttf python tools/assets/rebuild_dq_rtd_assets.py
```

For Windows PowerShell:

```powershell
$env:WIREBENCH_FONT = 'C:\path\to\DejaVuSans.ttf'
python tools/assets/rebuild_dq_rtd_assets.py
```

The script exits with a clear error if the font is missing or cannot be opened.
Use the same DejaVu Sans font to reproduce the existing outlines. Selecting a
different font intentionally changes the generated SVG geometry.

## AQ and Ex-AI

```sh
python tools/assets/build_vectors.py
```

This regenerates `module-aq.svg` and `module-ex-ai.svg`. It reads
`module-ex-ai.png` to retain the tiny unreadable factory markings. It does not
create raster previews. Its readable SVG text uses the browser's Arial/Helvetica
fallback stack, matching the existing illustrations.

## Scope and provenance

These are front-view illustrations reconstructed from the supplied references,
not dimensional manufacturer CAD models. See `ASSET_NOTES.md` for the source
images, model markings, and coordinate conventions.

The AI module illustration and standalone DIN resistor terminal illustration
are maintained directly as SVG assets; these two scripts do not regenerate them.
They also do not alter channel mappings, callout arrows, or app behavior.
