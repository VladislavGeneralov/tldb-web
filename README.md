# TLDB Web — Phase 1 (interface only)

Web interface for the Tselinny Library Database. Runs on the real catalog
export (`data/libraryDB.csv`, ~700 books) with cover photos where available
under `data/covers/` — there is no backend yet, this is a static site, so
editing the catalog still means editing the CSV by hand.

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
- QR scanning via the device camera. Uses the native `BarcodeDetector` API
  where the platform supports it (macOS/Android Chrome), and falls back to
  the vendored `jsQR` decoder (`js/vendor/jsQR.js`) everywhere else — which
  in practice means everywhere, since Windows/Linux desktop Chrome and Edge
  don't implement `BarcodeDetector` at all. A "not supported" message only
  shows if camera access itself fails or is denied.

## Known limitations of this phase

- No backend, database, or write-back — editing the catalog still means
  editing `data/libraryDB.csv` by hand and reloading.
- Cover photos only exist locally under `data/covers/<BOOK ID>.jpg|png` for
  the books that have one (currently 60 of ~700) — the rest show a "No
  Image" placeholder. The CSV's own QR LINK / IMAGE LINK columns are still
  local Windows paths from the original desktop app and won't resolve in a
  browser; they're shown as copyable reference text only.
- STATUS/CONDITION dropdown options are derived from whatever is actually in
  the CSV rather than a hardcoded enum — a backend should validate against a
  canonical list on write.

## Deploying

Static files only — this folder can be pushed as-is to GitHub Pages.
