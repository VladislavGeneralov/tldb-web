# TLDB Web — Phase 1 (interface only)

This is the `docs/` folder of the `tldb-web` repo — GitHub Pages only
supports serving from a repo's root or a `/docs` folder, so the actual
site lives here rather than at the repo root, leaving the parent Windows
folder (`Desktop/TLDB_web/`) free to hold just launcher shortcuts (open
the live catalog, open admin, open the CSV table).

Web interface for the Tselinny Library Database. The catalog (~700 books)
lives in a Cloudflare D1 database and is served through the `tldb-admin-auth`
Cloudflare Worker (`worker/`) — this static site fetches it live from there.
`data/libraryDB.csv` still ships in the repo as a point-in-time snapshot/
backup, but is no longer what the running site reads. Cover photos are
still local files under `data/covers/` (see "Known limitations" — no image
upload backend yet).

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
  link above the logo. Gated by a password prompt (`js/admin.js`) that
  is checked server-side by a Cloudflare Worker (`worker/`) — the real
  password lives only as a Worker secret, never in this repo or any
  client JS. The record form is always visible: **Scan QR** sets BOOK ID
  (same `codeScan.js` decoder as the public SCAN button); ISBN capture
  uses a live camera preview with a guide box + OCR (`Tesseract.js`, from
  CDN) on just that cropped region — EAN-13 barcode decoding was tried
  and abandoned for ISBN, see `js/isbn.js` and project notes for why — and
  looks the ISBN up on Open Library to auto-fill title/author/publisher/
  year, flagging a warning if the result looks transliterated/romanized
  rather than native script (common gap in Open Library's source data for
  Russian-group ISBNs). **Take Cover Photo** captures and downloads a
  resized cover image named after the current BOOK ID (still a manual
  download + drop into `data/covers/`, not an upload — see limitations). A
  ○/● checklist tracks whether QR/ISBN have been scanned; **Approve**
  checks required fields, then saves the record straight to the catalog
  (`POST /books` on the Worker, upserted into D1 by BOOK ID) — the public
  catalog picks it up on next load. A CSV row is still shown below as a
  manual-paste backup, but it's no longer needed for the save to take effect.

## Known limitations of this phase

- **Cover photo upload isn't backed by real storage.** Cloudflare R2 (object
  storage) needs to be enabled through the Cloudflare dashboard first, which
  requires adding a payment method even though usage stays within the free
  tier — deliberately not done yet. So **Take Cover Photo** still only
  downloads a resized image; someone has to manually drop it into
  `data/covers/<BOOK ID>.jpg` and commit it, same as the original 60 covers.
- **Auth is still a single shared password**, not per-user accounts — same
  password gates both reading the admin page and writing new/edited books
  (`worker/src/index.js` checks it server-side, but there's no session/token
  system, no audit trail of who saved what).
- STATUS/CONDITION dropdown options are derived from whatever is actually in
  the data rather than a hardcoded enum — the write API doesn't validate
  against a canonical list either.
- ISBN column exists in the schema but is empty for most current books.
- Open Library lookup coverage is partial for this catalog (English-language
  books matched in testing, Russian editions and small art-press titles
  mostly didn't, and some Russian-group ISBNs only have a romanized/
  transliterated record with no Cyrillic edition at all) — treat any
  auto-filled field as a draft to review, not ground truth.
- No version history/rollback on the D1 data — an overwrite (same BOOK ID)
  replaces the row with no undo beyond the CSV snapshot already in git.

## Deploying

The static site (this folder) deploys as-is to GitHub Pages. The backend
(`worker/`) deploys separately to Cloudflare:

```
cd worker
npx wrangler deploy
```
