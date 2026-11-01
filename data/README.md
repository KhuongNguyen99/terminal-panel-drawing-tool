# Source schedule

`rio-cable-schedule.csv` is the 132-row transcription of the two supplied RIO sheets. Its columns are `RIO`, `Slot`, `Channel`, `Pin Type`, `Device`, `cable number`, and `Tag`. Blank cable numbers remain blank where the handwritten source provided none.

The populated RIO A Slot 5 rows retain `Slot = 5`; their tags are corrected to `rioa.slot5.ai0` through `rioa.slot5.ai7`. The eight additional blank Slot 5 rows are preserved in this source transcription. The application merges them with the populated rows. The 24 `.wire_ok` rows are preserved here as status metadata and do not create additional physical channels in the editor.

`dist/schedule.js` contains the application's normalized schedule: 22 modules, 100 physical channels, 56 assigned devices, 44 spares, and 26 handwritten cable numbers. `examples/rio-schedule.wirebench.json` is an editable starting project generated from that schedule. Subsequent changes to the CSV do not automatically change the application: update `dist/schedule.js` and regenerate the example when the source assignments change.

Source photos are retained under `docs/references/`.
