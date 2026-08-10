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
- **`admin.html`** — stub admin page, linked from the small "ADMIN" link
  above the logo. Gated by a plain client-side password prompt
  (`js/admin.js`) — **not real security**, the password is a readable
  string in a public repo, it only deters casual clicks. Currently just a
  placeholder; see "Known limitations" below for the planned scope.

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
- `admin.html` is an empty placeholder behind a fake password gate. Planned
  (not built, needs a backend): scanning a QR there starts a **new**
  record (unlike the public SCAN button, which only looks up existing
  ones), and scanning an ISBN auto-fills that new record's title/author/
  publisher/year from Open Library / Google Books (both confirmed to allow
  direct client-side `fetch()`, no CORS issue) — with manual correction
  where the source data doesn't fit. Real-world coverage is partial for
  this catalog (English-language books matched in testing, Russian
  editions and small art-press titles mostly didn't) — treat as a
  draft-filling aid, not full automation.

## Deploying

Static files only — this folder can be pushed as-is to GitHub Pages.
