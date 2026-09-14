# Reverse-engineering notes: tooltrace.ai/designer

This document records what is known about the original product, how each part was
inferred, and where this reimplementation deliberately differs.

## Constraints on the analysis

The analysis was done from a sandbox whose egress policy blocks `tooltrace.ai`, its Vercel
preview deployment (`shadowbox-seven.vercel.app`) and every third-party review site, so the
live page could not be fetched, and no HTML, JavaScript bundle or API traffic was inspected.
Everything below comes from search-engine snippets of the official pages (`/`, `/how-to`,
`/about`, `/5s`) and of reviews (CNC Kitchen, All3DP, ilove3dprinting, TraceToForge,
abit.ee, agentspointee, aimode) plus general knowledge of the Gridfinity specification.
Nothing here is derived from the original source code, and no original assets are used.

## What the product does

Tooltrace is a free browser app that converts a top-down photo of tools lying on a sheet of
paper into scaled outlines, and then into either a cut layout for shadowbox / Kaizen foam or
a custom Gridfinity insert. Files are "generated securely on your device"; sign-in is required
to download; the free tier allows 3 active designs and Pro is US$8/month.

## Workflow as documented

| Step | Original behaviour (from docs/reviews) | This reimplementation |
| --- | --- | --- |
| Photo | Upload a photo taken straight from above with an A4 or Letter sheet in frame. | Drag-and-drop / file picker / synthetic demo photo. EXIF orientation honoured, downscaled to 2400 px. |
| Set scale | "Select the paper size you used and mark its corners." The site also "finds the corners of the sheet" automatically. | Paper size picker (A4, Letter, Legal, A3, A5, Tabloid, custom), landscape toggle, automatic corner detection (Otsu threshold → largest bright component → convex hull → max-area quad), draggable handles, aspect-ratio sanity warning. The photo is rectified with a homography so tools next to the sheet are kept. |
| Trace tools | "Click New Tool and highlight each item; for complex tools with multiple colours add extra markers"; "click anywhere on the tool and the AI will detect the outline". | `New Tool` + click. Positive markers union, right-click / Shift-click adds negative markers. Default engine is a classical background-difference segmenter that runs instantly in a Web Worker; an optional neural engine (SlimSAM via transformers.js, loaded from a CDN) is selectable. |
| Configure Layout | Foam / Gridfinity mode; offset presets ("choose small for a snug fit"); pocket depth; "automatically adds a 10 mm base"; arrange contours; add finger cutouts; set insert depth and dimensions; 42 mm grid; grooves on the bottom for mounting. | Same controls: mode toggle, offset presets small/medium/large/custom (0.5/1/2 mm), depth slider with the 10 mm floor, optional snap to 7 mm height units, auto-sized or manual X×Y units, magnet holes, foam sheet size/thickness/depth/margin/corner radius, spacing, finger-cutout diameter, drag/rotate/nudge, auto-arrange, 3D preview. |
| Export | Gridfinity: STL, STEP, 3MF. Foam: DXF, SVG. | Gridfinity: STL, 3MF (+ SVG/DXF of the layout). Foam: DXF, SVG (+ STL). STEP is not implemented: it needs a B-rep kernel, which is out of scope for a client-only build. Outlines can also be exported as JSON. |

## Inferred internals

* **Scale calibration** is a plane homography from the four paper corners; this is the only
  way "click on the paper to set the scale" can produce millimetre accuracy without camera
  calibration. The rectified image is rendered at 4 px/mm (capped at ~6 MP).
* **"AI detects the exact outline"** with a single click is characteristic of a
  Segment-Anything-class prompt-based model. The original most likely runs it server-side.
  The open-source predecessor by the same name (`skotagiri/tooltrace`, Rust) uses FastSAM via
  ONNX Runtime, which supports that reading. Here the neural path is optional and on-device.
* **Offset presets** map to fixed millimetre clearances in the original ("small" = snug).
  Exact values are not published; 0.5 / 1.0 / 2.0 mm were chosen from common foam-insert
  practice and are editable.
* **Gridfinity geometry** follows the public spec: 42 mm pitch, 41.5 mm footprint, 7 mm
  height units, 3.75 mm corner radius, base profile 0.8 mm chamfer / 1.8 mm vertical /
  2.15 mm chamfer, 6.5 × 2.4 mm magnet pockets 13 mm from the cell centre.
* **"10 mm base"** is treated as a fixed floor: bin height = pocket depth + 10 mm. The pocket
  floor sits 5.25 mm above the 4.75 mm stacking base.

## Not reproduced

* Accounts, sign-in gate, free-tier limit and Pro billing.
* STEP export.
* Labels engraved into the insert (mentioned by one review; details unknown).
* Server-side model inference; the neural option here downloads weights into the browser.
