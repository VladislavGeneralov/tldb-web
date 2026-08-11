# TLDB Web — Phase 1 (interface only)

This is the `docs/` folder of the `tldb-web` repo — GitHub Pages only
supports serving from a repo's root or a `/docs` folder, so the actual
site lives here rather than at the repo root, leaving the parent Windows
folder (`Desktop/TLDB_web/`) free to hold just launcher shortcuts (open
the live catalog, open admin, open the CSV table).

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
- **SCAN** — one button, one camera view, reads either a book's TL QR code
  or its ISBN-13 barcode (`js/codeScan.js`). Uses the native
  `BarcodeDetector` API where the platform supports both formats at once
  (macOS/Android Chrome), falling back to a vendored `ZXing-js`
  (`js/vendor/zxing.min.js`) everywhere else — in practice everywhere,
  since Windows/Linux desktop Chrome/Edge don't implement `BarcodeDetector`
  at all. Both are read-only lookups against the loaded catalog, never
  write anything: a QR match always identifies exactly one physical copy
  and opens it directly; an ISBN identifies an edition, so a match filters
  the table to every copy sharing it and only auto-opens the book card when
  that's unambiguous (exactly one copy). Requests an HD camera stream
  (`{ width: { ideal: 1920 }, height: { ideal: 1080 } }`) rather than
  whatever low-res default the browser might otherwise pick — EAN-13's
  finer bar spacing needs more resolution than QR's built-in redundancy
  tolerates.
- **`admin.html`** — new-record draft tool, linked from the small "ADMIN"
  link above the logo. Gated by a plain client-side password prompt
  (`js/admin.js`, password `admin00`) — **not real security**, the
  password is a readable string in a public repo, it only deters casual
  clicks. The record form is always visible: **Scan QR** sets BOOK ID
  (same `codeScan.js` decoder as the public SCAN button); ISBN capture
  uses a live camera preview with a guide box + OCR (`Tesseract.js`, from
  CDN) on just that cropped region — EAN-13 barcode decoding was tried
  and abandoned for ISBN, see `js/isbn.js` and project notes for why — and
  looks the ISBN up on Open Library to auto-fill title/author/publisher/
  year, flagging a warning if the result looks transliterated/romanized
  rather than native script (common gap in Open Library's source data for
  Russian-group ISBNs). **Take Cover Photo** captures and downloads a
  resized cover image named after the current BOOK ID. A ○/● checklist
  tracks whether QR/ISBN have been scanned; **Approve** lists any columns
  still blank as a reminder, then formats every field into a CSV row to
  paste into `libraryDB.csv` by hand — nothing here saves anywhere, there's
  no backend.

## Known limitations of this phase

- No backend, database, or write-back — editing the catalog still means
  editing `data/libraryDB.csv` by hand and reloading.
- Cover photos only exist locally under `data/covers/<BOOK ID>.jpg` for the
  books that have one (currently 60 of ~700) — the rest show a "No Image"
  placeholder. The CSV's own QR LINK / IMAGE LINK columns are still local
  Windows paths from the original desktop app and won't resolve in a
  browser; they're shown as copyable reference text only.
- STATUS/CONDITION dropdown options are derived from whatever is actually in
  the CSV rather than a hardcoded enum — a backend should validate against a
  canonical list on write.
- ISBN column exists in the schema but is empty for every current book.
- `admin.html`'s record form doesn't save anywhere — it only formats a CSV
  row to paste into `libraryDB.csv` and a cover photo to manually drop into
  `data/covers/` by hand. Real needs a backend: a write API, real auth
  (the password gate is client-side only, not real security), and actual
  persistence. Open Library lookup coverage is partial for this catalog
  (English-language books matched in testing, Russian editions and small
  art-press titles mostly didn't, and some Russian-group ISBNs only have a
  romanized/transliterated record with no Cyrillic edition at all) — treat
  any auto-filled field as a draft to review, not ground truth.

## Deploying

Static files only — this folder can be pushed as-is to GitHub Pages.
