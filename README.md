# TLDB Web — Phase 1 (interface only)

Web interface for the Tselinny Library Database. Currently runs entirely on
fixture data (`data/libraryDB.csv`, copied from the original Processing
desktop app) — there is no backend yet, this is a static site.

## Running locally

Browsers block `fetch()` of local files under `file://`, so open this
through a static server rather than double-clicking `index.html`.

On Windows, double-click `run-server.bat` — it starts the server on
http://localhost:8123/ and opens it in your default browser.

Otherwise, from this folder:

```
python -m http.server 8123
```

then visit http://localhost:8123/. (VS Code's "Live Server" extension
works too.)

## What's implemented

- General search + per-column filters (text, multi-select for
  LANGUAGE(S)/GENRE(S), single-select for CONDITION/STATUS), all live-updating.
- Sortable results table with a visible copy-to-clipboard affordance per cell.
- Book detail panel (click a row), with copy/open-link controls.
- QR scanning via the device camera, using the browser's native
  `BarcodeDetector` API (Chrome/Edge). Unsupported browsers show a message
  instead of failing silently.

## Known limitations of this phase

- No backend, database, or write-back — editing the catalog still means
  editing `data/libraryDB.csv` by hand and reloading.
- QR LINK / IMAGE LINK values in the fixture are local Windows file paths
  from the original desktop app and won't resolve in a browser. Real image
  hosting is a follow-up once there's a funded host for it.
- STATUS/CONDITION dropdown options are derived from whatever is actually in
  the CSV (including any inconsistent/typo'd values) rather than a hardcoded
  enum — a backend should validate against a canonical list on write.

## Deploying

Static files only — this folder can be pushed as-is to GitHub Pages.
