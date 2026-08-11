// TLDB Web — admin panel stub.
//
// The password gate is checked server-side by a Cloudflare Worker
// (see worker/src/index.js) so the real password never ships in this
// file or any other client JS — view-source no longer reveals it.
// The "unlocked" flag below is still just a client-side UI flag once
// the Worker confirms the password, same as before: there's nothing
// sensitive behind the gate yet (no backend save), so that's fine.

import { isValidIsbn13, extractIsbn13, guessIsbnRegion, looksTransliterated } from './isbn.js';
import { lookupIsbn } from './isbnLookup.js';
import { COLUMNS, loadBooks, deriveFilterOptions, BOOKS_API_URL } from './data.js';
import { CodeScanner, validateTLId, isScanSupported } from './codeScan.js';

const AUTH_ENDPOINT = 'https://tldb-admin-auth.ptntonesix.workers.dev/check-password';
const SESSION_KEY = 'tldb-admin-unlocked';
const SESSION_PWD_KEY = 'tldb-admin-pwd';

// The GitHub PAT backing the weekly D1->CSV backup (worker/src/index.js's
// scheduled() handler) expires on this date — fine-grained PATs can't be
// set to never expire in a way we chose here. Not a secret, just a
// reminder date, so it's fine as a plain constant. When it expires, the
// weekly backup silently starts failing (GitHub API returns 401) until a
// new token is generated and set via `wrangler secret put GITHUB_TOKEN`.
const GITHUB_TOKEN_EXPIRES = new Date('2026-11-09');

renderTokenCountdown();

function renderTokenCountdown() {
  const el = document.getElementById('admin-token-countdown');
  if (!el) return;
  const daysLeft = Math.ceil((GITHUB_TOKEN_EXPIRES - new Date()) / (1000 * 60 * 60 * 24));
  el.textContent = `GitHub token: ${daysLeft}d left`;
  el.classList.toggle('warn', daysLeft <= 30 && daysLeft > 7);
  el.classList.toggle('critical', daysLeft <= 7);
}

// Kept in memory only (not persisted anywhere) once the gate accepts it, so
// Approve can authenticate its save call without asking the admin to type
// the password a second time. There's no separate session/token system —
// same shared-password model as the gate itself.
let adminPassword = '';

const gate = document.getElementById('admin-gate');
const gateForm = document.getElementById('admin-gate-form');
const gateInput = document.getElementById('admin-gate-input');
const gateError = document.getElementById('admin-gate-error');
const gateSubmit = gateForm.querySelector('button[type="submit"]');
const panel = document.getElementById('admin-panel');

function unlock() {
  gate.hidden = true;
  panel.hidden = false;
}

if (sessionStorage.getItem(SESSION_KEY) === '1') {
  adminPassword = sessionStorage.getItem(SESSION_PWD_KEY) || '';
  unlock();
}

gateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  gateError.textContent = '';
  gateSubmit.disabled = true;
  try {
    const res = await fetch(AUTH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: gateInput.value }),
    });
    const data = await res.json();
    if (data.ok) {
      adminPassword = gateInput.value;
      sessionStorage.setItem(SESSION_KEY, '1');
      sessionStorage.setItem(SESSION_PWD_KEY, adminPassword);
      unlock();
    } else if (res.status === 429) {
      // Rate-limited (5 attempts/minute across all password routes, see
      // worker/src/index.js) — distinct from a wrong password so the admin
      // isn't left thinking they mistyped it when they're actually just
      // locked out for the rest of the minute.
      gateError.textContent = data.error || 'Too many attempts — wait a minute and try again.';
    } else {
      gateError.textContent = 'Incorrect password.';
      gateInput.value = '';
      gateInput.focus();
    }
  } catch {
    gateError.textContent = 'Could not reach the auth server — check your connection and try again.';
  } finally {
    gateSubmit.disabled = false;
  }
});

// --- ISBN capture test tool ---------------------------------------------
// Live EAN-13 barcode scanning (continuous video and single-photo decode)
// was dropped: real test photos were consistently too motion-blurred for
// the barcode's precise bar widths, even when the printed ISBN digits
// right next to it stayed legible. OCR on a *whole* native camera photo
// then also failed — the background/shadow texture around the small text
// region confused Tesseract into hallucinating text everywhere. But OCR
// on a *tight crop of just the text line* (no barcode, no background)
// read it correctly. Native <input capture> can't be cropped before the
// OS hands back the photo, so this uses our own getUserMedia preview with
// a guide box instead, crops to exactly that box at capture time, and
// only OCRs the crop. Falls back to the admin just typing the ISBN in.
//
// Tesseract.js is loaded from CDN in admin.html, not vendored locally
// like jsQR/ZXing — its worker+wasm+language-data asset pipeline is a lot
// more involved to self-host, and this whole page is an experimental
// admin-only test area already.
//
// A validated ISBN (checksum-checked, from OCR or manual entry) triggers
// the "New record draft" form further down — see handleValidIsbn below.

const isbnResult = document.getElementById('admin-isbn-result');
const isbnPhotoPreview = document.getElementById('admin-isbn-photo-preview');
const isbnInput = document.getElementById('admin-isbn-input');
const isbnValidateBtn = document.getElementById('admin-isbn-validate-btn');

const openCameraBtn = document.getElementById('admin-isbn-open-camera-btn');
const cameraWrap = document.getElementById('admin-isbn-camera-wrap');
const video = document.getElementById('admin-isbn-video');
const captureBtn = document.getElementById('admin-isbn-capture-btn');
const cameraCancelBtn = document.getElementById('admin-isbn-camera-cancel-btn');

// Fractions of the video's *native* resolution matching the guide box's
// CSS position (see .admin-isbn-guide — must stay in sync with these
// numbers, they're duplicated there since CSS positions the visible box
// and this defines the actual crop). Video is displayed at
// width:100%/height:auto so it keeps its native aspect ratio, meaning
// these fractions map directly to pixels in the captured frame.
// Smaller box == less of the frame the text needs to fill == the phone
// can stay farther back instead of being held right up against the page.
const GUIDE = { x: 0.29, y: 0.46, w: 0.42, h: 0.08 };
const CAPTURE_UPSCALE = 2; // matched what fixed a misread digit in testing

let stream = null;

openCameraBtn.addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (e) {
    isbnResult.textContent = 'Could not access the camera. Check browser permissions.';
    return;
  }
  video.srcObject = stream;
  await video.play();
  cameraWrap.hidden = false;
});

cameraCancelBtn.addEventListener('click', closeCamera);

function closeCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  cameraWrap.hidden = true;
}

captureBtn.addEventListener('click', async () => {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sx = vw * GUIDE.x;
  const sy = vh * GUIDE.y;
  const sw = vw * GUIDE.w;
  const sh = vh * GUIDE.h;

  const canvas = document.createElement('canvas');
  canvas.width = sw * CAPTURE_UPSCALE;
  canvas.height = sh * CAPTURE_UPSCALE;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  closeCamera();

  canvas.toBlob((blob) => runOcr(blob), 'image/png');
});

isbnValidateBtn.addEventListener('click', () => {
  const digits = isbnInput.value.replace(/[^0-9]/g, '');
  if (isValidIsbn13(digits)) {
    isbnResult.textContent = `Valid ISBN-13: ${digits}`;
    handleValidIsbn(digits);
  } else {
    isbnResult.textContent = `Not a valid ISBN-13 (bad format or checksum): "${isbnInput.value}"`;
  }
});

async function runOcr(blob) {
  isbnPhotoPreview.src = URL.createObjectURL(blob);
  isbnPhotoPreview.hidden = false;
  isbnResult.textContent = 'Running OCR on the crop…';

  try {
    const { data } = await Tesseract.recognize(blob, 'eng');
    const found = extractIsbn13(data.text);
    if (found) {
      isbnInput.value = found;
      isbnResult.textContent = `OCR found a valid ISBN: ${found}`;
      handleValidIsbn(found);
    } else {
      isbnResult.textContent = `OCR read "${data.text.trim()}" — no valid ISBN in that. Read it off the preview and type it in below.`;
    }
  } catch (e) {
    isbnResult.textContent = `OCR failed (${e.message}) — type the ISBN in manually.`;
  }
}

// --- New record draft form -----------------------------------------------
// Always visible, empty, ready to fill by hand from the start. Scanning a
// QR sets BOOK ID; scanning/typing an ISBN looks it up and sets the
// bibliographic fields — either order, independently, neither one wipes
// what the other already filled in. Approve saves the record to the real
// catalog (POST /books on the Worker, upserted into D1 by BOOK ID) and
// still shows a CSV row as a manual-paste backup, after reminding about
// any columns still left blank (both scans are meant to
// be done, not just one).

const recordFields = document.getElementById('admin-record-fields');
const recordApproveBtn = document.getElementById('admin-record-approve-btn');
const recordOutput = document.getElementById('admin-record-output');
const recordCsvArea = document.getElementById('admin-record-csv');
const recordCopyBtn = document.getElementById('admin-record-copy-btn');
const recordWarning = document.getElementById('admin-record-warning');
const checklistQr = document.getElementById('admin-checklist-qr');
const checklistIsbn = document.getElementById('admin-checklist-isbn');

function todayFormatted() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function initialDefaults() {
  const today = todayFormatted();
  const values = {};
  for (const col of COLUMNS) values[col.id] = '';
  values.status = 'Available';
  values.createdAt = today;
  values.updatedAt = today;
  return values;
}

// №, QR LINK and IMAGE LINK aren't shown as text fields: № was always
// just row position, not real data; QR LINK isn't collectible without
// the original desktop app's label printer; IMAGE LINK gets set
// automatically once a cover photo is captured (see below) rather than
// typed. They stay as hidden inputs so the CSV-building logic below
// doesn't need special-casing per column — every column still has a
// `record-<id>` element, just not all of them are visible.
const NO_VISIBLE_FIELD = new Set(['num', 'qrLink', 'imageLink']);

// Existing-value pick lists for LANGUAGE(S)/GENRE(S)/PUBLISHER, offered as
// popovers next to those fields (see attachPicker below). Loaded once from
// the real catalog (read-only — this page never writes to it) and mutated
// in place rather than reassigned, so a popover opened after loading
// finishes, or after an "Add new", always sees the latest list. Declared
// before renderRecordFields's first call below since attachPicker reads
// from it immediately.
const PICKER_OPTIONS = { languages: [], genres: [], publisher: [] };

// Loaded once alongside PICKER_OPTIONS, kept around so a scanned/typed
// BOOK ID can be checked against the real catalog before Approve — see
// checkBookIdForExisting below. Approve now actually saves (INSERT OR
// REPLACE by BOOK ID), so silently "starting a new record" on an ID that
// already exists would overwrite that book's real data with a mostly
// blank draft; this is what stops that.
let CATALOG_BOOKS = [];

// Snapshot of the real record checkBookIdForExisting last matched, used by
// Approve to show a before/after diff instead of saving blind. Cleared
// whenever the current BOOK ID no longer matches that snapshot (typed over,
// or a fresh scan resolves to something else) so a stale diff can never be
// shown against the wrong book.
let existingRecordSnapshot = null;

loadBooks().then((books) => {
  CATALOG_BOOKS = books;

  // PUBLISHER is multiValue now (co-publications like "Ад Маргинем Пресс;
  // Garage" are common, ~40 of 700 books) so deriveFilterOptions splits it
  // into individual publisher names the same way it already does for
  // LANGUAGE(S)/GENRE(S), instead of treating each combination as its own
  // option.
  const derived = deriveFilterOptions(books);
  PICKER_OPTIONS.languages.push(...(derived.languages || []));
  PICKER_OPTIONS.genres.push(...(derived.genres || []));
  PICKER_OPTIONS.publisher.push(...(derived.publisher || []));
}).catch(() => {
  // catalog failed to load — pickers just show only "Add new", still usable
});

// Called whenever BOOK ID is set (QR scan or manual typing/paste). If that
// ID already has a record, loads its real data into the form instead of
// leaving the admin's blank draft fields to silently overwrite it on
// Approve — turns an accidental overwrite into a visible, intentional
// edit. CATALOG_BOOKS may still be empty if the catalog hasn't finished
// loading yet; in that case this can't detect a collision, same limit as
// PICKER_OPTIONS above.
function checkBookIdForExisting(bookId) {
  const existing = CATALOG_BOOKS.find((b) => b.bookId === bookId);
  if (!existing) {
    existingRecordSnapshot = null;
    return;
  }
  existingRecordSnapshot = { ...existing };

  for (const col of COLUMNS) setRecordField(col.id, existing[col.id] || '');
  // Only reflects "this data is already known", not "a scan happened" —
  // don't mark checklistQr here, callers that actually scanned a QR
  // already set it themselves before calling this.
  if (existing.isbn) setChecklist(checklistIsbn, true);
  showRecordNotice(
    `⚠ ${bookId} already exists in the catalog (${existing.name || 'untitled'} — ` +
    `${existing.authors || 'unknown author'}). Loaded its current data — Approve will ` +
    `update this record, not create a new one.`
  );
}

function renderRecordFields(values) {
  recordFields.innerHTML = '';

  for (const col of COLUMNS) {
    if (NO_VISIBLE_FIELD.has(col.id)) {
      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.id = `record-${col.id}`;
      hidden.value = values[col.id] || '';
      recordFields.appendChild(hidden);
      continue;
    }

    const wrap = document.createElement('div');
    wrap.className = 'admin-record-field';

    const label = document.createElement('label');
    label.textContent = col.label;
    label.htmlFor = `record-${col.id}`;
    wrap.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.id = `record-${col.id}`;
    input.value = values[col.id] || '';

    if (col.id === 'status') {
      input.setAttribute('list', 'admin-record-status-options');
      const datalist = document.createElement('datalist');
      datalist.id = 'admin-record-status-options';
      for (const opt of ['Available', 'Loaned', 'FAO', 'Discarded', 'Restoration']) {
        const option = document.createElement('option');
        option.value = opt;
        datalist.appendChild(option);
      }
      wrap.appendChild(datalist);
    }

    if (col.id === 'languages' || col.id === 'genres' || col.id === 'publisher') {
      const row = document.createElement('div');
      row.className = 'admin-record-input-row';
      row.appendChild(input);
      wrap.appendChild(row);
      attachPicker(row, input, PICKER_OPTIONS[col.id]);
    } else {
      wrap.appendChild(input);
    }

    recordFields.appendChild(wrap);
  }
}

function setRecordField(id, value) {
  const input = document.getElementById(`record-${id}`);
  if (input) input.value = value;
}

function getRecordField(id) {
  const input = document.getElementById(`record-${id}`);
  return input ? input.value : '';
}

renderRecordFields(initialDefaults());

// Covers manually typing/pasting a BOOK ID (not just scanning it) — see
// checkBookIdForExisting above for why this check exists at all.
document.getElementById('record-bookId').addEventListener('blur', () => {
  checkBookIdForExisting(getRecordField('bookId').trim());
});

// Always multi-select (checkboxes): LANGUAGE(S)/GENRE(S)/PUBLISHER all
// legitimately have more than one value on real books (co-publications,
// multiple languages in one edition, etc.) — see project notes on why
// PUBLISHER joined this list (~40 of 700 books have 2-3 co-publishers).
function attachPicker(wrap, input, options) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'admin-picker-btn';
  btn.title = 'Pick from list';
  btn.textContent = '▾';

  const popup = document.createElement('div');
  popup.className = 'admin-picker-popup';
  popup.hidden = true;

  function currentValues() {
    return input.value.split(';').map((s) => s.trim()).filter(Boolean);
  }

  function renderList() {
    popup.innerHTML = '';
    const selected = currentValues();

    if (options.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'admin-picker-empty';
      empty.textContent = 'No existing values yet.';
      popup.appendChild(empty);
    }

    for (const opt of options) {
      const item = document.createElement('label');
      item.className = 'admin-picker-item';

      const control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = selected.includes(opt);
      control.addEventListener('change', () => {
        const set = new Set(currentValues());
        if (control.checked) set.add(opt);
        else set.delete(opt);
        input.value = [...set].join('; ');
      });

      // Text in its own flex:1 span (not a bare text node) so it reliably
      // fills the remaining row width, pushing control to sit flush at the
      // row's right edge — lines up in a column regardless of text length.
      const text = document.createElement('span');
      text.className = 'admin-picker-item-text';
      text.textContent = opt;
      item.append(text, control);
      popup.appendChild(item);
    }

    const addRow = document.createElement('div');
    addRow.className = 'admin-picker-add';
    const addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.placeholder = 'Add new…';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = 'Add';

    function addNew() {
      const val = addInput.value.trim();
      if (!val) return;
      if (!options.includes(val)) {
        options.push(val);
        options.sort((a, b) => a.localeCompare(b));
      }
      const set = new Set(currentValues());
      set.add(val);
      input.value = [...set].join('; ');
      addInput.value = '';
      renderList();
    }

    addBtn.addEventListener('click', addNew);
    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addNew();
      }
    });

    addRow.append(addInput, addBtn);
    popup.appendChild(addRow);

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'admin-picker-done';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', () => { popup.hidden = true; });
    popup.appendChild(doneBtn);
  }

  btn.addEventListener('click', () => {
    popup.hidden = !popup.hidden;
    if (!popup.hidden) renderList();
  });

  // Closes the popup on an outside click. Safe against the toggle click
  // above re-opening it: that click's target (btn, or anything inside
  // popup) is always contained in wrap, so this only fires for clicks
  // genuinely outside it.
  document.addEventListener('click', (e) => {
    if (!popup.hidden && !wrap.contains(e.target)) {
      popup.hidden = true;
    }
  });

  wrap.appendChild(btn);
  wrap.appendChild(popup);
}

async function handleValidIsbn(isbn) {
  setRecordField('isbn', isbn);
  setChecklist(checklistIsbn, true);

  const found = await lookupIsbn(isbn).catch(() => null);
  if (found) {
    if (found.authors) setRecordField('authors', found.authors);
    if (found.title) setRecordField('name', found.title);
    if (found.publisher) setRecordField('publisher', found.publisher);
    if (found.year) setRecordField('year', found.year);
  }

  // Open Library sometimes only has a romanized MARC record for a given
  // ISBN, with no Cyrillic/native-script edition at all anywhere in its
  // data (confirmed by hand for a real book — see project notes) — no
  // smarter query fixes that, it's a gap in the source data itself. Flag
  // it instead of silently handing back transliterated text as if it
  // were correct.
  const region = guessIsbnRegion(isbn);
  const combinedText = `${found?.title || ''} ${found?.authors || ''} ${found?.publisher || ''}`;
  if (found && looksTransliterated(region, combinedText)) {
    showRecordNotice(
      '⚠ This looks transliterated/romanized, not native script — Open Library has no ' +
      'Cyrillic edition for this ISBN. Retype BOOK NAME/AUTHOR(S)/PUBLISHER in the correct ' +
      'script yourself before approving.'
    );
  }

  tryFetchOpenLibraryCover(isbn);
}

function showRecordNotice(text) {
  recordWarning.textContent = text;
  recordWarning.hidden = false;
}

function setChecklist(el, done) {
  el.classList.toggle('pending', !done);
  el.classList.toggle('done', done);
  el.textContent = (done ? '● ' : '○ ') + el.textContent.slice(2);
}

// № is just row position (never filled here) and QR LINK isn't
// collectible without the original label printer — don't nag about
// those two, ever. Everything else is either required to approve at all,
// or optional-but-confirm-if-blank.
const SKIP_COMPLETENESS_CHECK = new Set(['num', 'qrLink']);
const REQUIRED_TO_APPROVE = new Set(['bookId', 'name', 'authors', 'status', 'createdAt', 'updatedAt']);

recordApproveBtn.addEventListener('click', async () => {
  // Set at the moment of the actual save, not whenever the form happened
  // to be loaded/opened — matters both for a fresh record filled out over
  // several minutes and for an existing one loaded via
  // checkBookIdForExisting (which otherwise leaves this at its old,
  // pre-edit value). REC CREATION DATE is untouched here on purpose: it
  // should stay today for a new record (already set by initialDefaults)
  // and stay as the original date for an edit (already loaded by
  // checkBookIdForExisting).
  setRecordField('updatedAt', todayFormatted());

  const missingRequired = COLUMNS.filter(
    (col) => REQUIRED_TO_APPROVE.has(col.id) && !getRecordField(col.id).trim()
  ).map((col) => col.label);

  if (missingRequired.length > 0) {
    showRecordNotice(`⚠ Required before approving: ${missingRequired.join(', ')}.`);
    recordOutput.hidden = true;
    return;
  }

  const missingOptional = COLUMNS.filter(
    (col) =>
      !SKIP_COMPLETENESS_CHECK.has(col.id) &&
      !REQUIRED_TO_APPROVE.has(col.id) &&
      !getRecordField(col.id).trim()
  ).map((col) => col.label);

  if (missingOptional.length > 0) {
    const proceed = window.confirm(
      `Still blank: ${missingOptional.join(', ')}. Approve anyway?`
    );
    if (!proceed) {
      showRecordNotice(`⚠ Still blank: ${missingOptional.join(', ')}. Fill these in, or click Approve again to confirm.`);
      recordOutput.hidden = true;
      return;
    }
  }

  recordWarning.hidden = true;
  const row = COLUMNS.map((col) => csvField(getRecordField(col.id))).join(',');
  recordCsvArea.value = row;
  recordOutput.hidden = false;

  const book = {};
  for (const col of COLUMNS) book[col.id] = getRecordField(col.id);

  // Overwriting an existing record (not creating a new one): show exactly
  // what will change before touching the real catalog, rather than trusting
  // that the admin remembers everything they edited. New records (no
  // matching snapshot) skip straight to saving — there's nothing to diff
  // against.
  if (existingRecordSnapshot && existingRecordSnapshot.bookId === book.bookId) {
    const changedCols = COLUMNS.filter(
      (col) => (existingRecordSnapshot[col.id] || '') !== (book[col.id] || '')
    );
    if (changedCols.length > 0) {
      const confirmed = await showDiffConfirm(changedCols, existingRecordSnapshot, book);
      if (!confirmed) {
        showSaveStatus('Save cancelled — back to editing.', 'pending');
        return;
      }
    }
  }

  await saveRecord(book);
});

async function saveRecord(book) {
  recordApproveBtn.disabled = true;
  showSaveStatus('Saving…', 'pending');
  try {
    const res = await fetch(BOOKS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, book }),
    });
    const data = await res.json();
    if (data.ok) {
      showSaveStatus(`✓ Saved ${book.bookId} to the catalog.`, 'success');
      existingRecordSnapshot = { ...book };
    } else {
      showSaveStatus(`⚠ Save failed: ${data.error || res.status}`, 'error');
    }
  } catch {
    showSaveStatus('⚠ Save failed: could not reach the server. The CSV row below is still available as a backup.', 'error');
  } finally {
    recordApproveBtn.disabled = false;
  }
}

// Before/after confirmation for overwriting an existing record — resolves
// true if the admin clicks "Save changes", false on "Back to editing"
// (including closing via the × button, which also counts as back-out).
const diffModal = document.getElementById('admin-diff-modal');
const diffList = document.getElementById('admin-diff-list');
const diffBackBtn = document.getElementById('admin-diff-back-btn');
const diffConfirmBtn = document.getElementById('admin-diff-confirm-btn');

function showDiffConfirm(changedCols, oldBook, newBook) {
  diffList.innerHTML = '';
  for (const col of changedCols) {
    const rowEl = document.createElement('div');
    rowEl.className = 'admin-diff-row';

    const label = document.createElement('div');
    label.className = 'admin-diff-label';
    label.textContent = col.label;

    const oldVal = document.createElement('div');
    oldVal.className = 'admin-diff-old';
    oldVal.textContent = oldBook[col.id] || '—';

    const newVal = document.createElement('div');
    newVal.className = 'admin-diff-new';
    newVal.textContent = newBook[col.id] || '—';

    rowEl.append(label, oldVal, newVal);
    diffList.appendChild(rowEl);
  }

  diffModal.hidden = false;

  return new Promise((resolve) => {
    const cleanup = (result) => {
      diffModal.hidden = true;
      diffBackBtn.removeEventListener('click', onBack);
      diffConfirmBtn.removeEventListener('click', onConfirm);
      resolve(result);
    };
    const onBack = () => cleanup(false);
    const onConfirm = () => cleanup(true);
    diffBackBtn.addEventListener('click', onBack);
    diffConfirmBtn.addEventListener('click', onConfirm);
  });
}

function showSaveStatus(text, kind) {
  const saveStatus = document.getElementById('admin-record-save-status');
  saveStatus.textContent = text;
  saveStatus.hidden = false;
  saveStatus.className = `admin-record-save-status ${kind}`;
}

recordCopyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(recordCsvArea.value);
});

function csvField(value) {
  if (/[",\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}

// --- Scan QR (Book ID) ----------------------------------------------------
// Reuses the same CodeScanner as the public catalog's SCAN button
// (js/codeScan.js), restricted to qr_code only — QR scanning itself was
// never the unreliable part (that was EAN-13 barcode decoding), so no
// need for the OCR/guide-box workaround here.

const qrScanBtn = document.getElementById('admin-scan-qr-btn');
const qrModal = document.getElementById('admin-qr-modal');
const qrCloseBtn = document.getElementById('admin-qr-close-btn');
const qrVideo = document.getElementById('admin-qr-video');
const qrStatus = document.getElementById('admin-qr-status');

let qrScanner = null;

qrScanBtn.addEventListener('click', openQrScanner);
qrCloseBtn.addEventListener('click', closeQrScanner);

async function openQrScanner() {
  qrModal.hidden = false;
  qrStatus.textContent = "Point the camera at the book's QR code…";

  if (!isScanSupported()) {
    qrStatus.textContent = "Scanning isn't supported in this browser — try Chrome or Edge.";
    return;
  }

  qrScanner = new CodeScanner(qrVideo, ['qr_code']);
  try {
    await qrScanner.start((rawValue) => {
      if (!validateTLId(rawValue)) {
        qrStatus.textContent = 'NOT A TSELINNY LIBRARY QR CODE';
        qrScanner.pause();
        setTimeout(() => qrScanner && qrScanner.resume(), 1500);
        return;
      }
      closeQrScanner();
      setRecordField('bookId', rawValue);
      setChecklist(checklistQr, true);
      syncCoverFilename();
      checkBookIdForExisting(rawValue);
    });
  } catch (e) {
    qrStatus.textContent = 'Could not access the camera. Check browser permissions.';
  }
}

function closeQrScanner() {
  if (qrScanner) {
    qrScanner.stop();
    qrScanner = null;
  }
  qrModal.hidden = true;
}

// --- Cover photo: camera capture or auto-fetched from Open Library -------
// No backend to upload to, so this can't save into data/covers/ directly —
// browsers can't write to the site's own files. Instead: get a cover from
// either source, resize+compress it to the same convention the real
// catalog's covers already use (max ~800px, JPEG ~82% — see project notes
// on compressing the 60 real covers) via the shared resizeToCoverBlob, and
// offer it as a download, and set IMAGE LINK to the path it *should* live
// at once someone drops the downloaded file into data/covers/ by hand.
// The filename/path depend on BOOK ID, which might not be scanned yet —
// kept in sync via syncCoverFilename(), called again whenever BOOK ID
// changes after a cover's already been set.

const coverOpenBtn = document.getElementById('admin-cover-open-camera-btn');
const coverModal = document.getElementById('admin-cover-camera-modal');
const coverVideo = document.getElementById('admin-cover-video');
const coverCaptureBtn = document.getElementById('admin-cover-capture-btn');
const coverCancelBtn = document.getElementById('admin-cover-camera-cancel-btn');
const coverCloseBtn = document.getElementById('admin-cover-camera-close-btn');
const coverPreview = document.getElementById('admin-cover-preview');
const coverDownloadLink = document.getElementById('admin-cover-download-link');

const COVER_MAX_DIMENSION = 800;
const COVER_JPEG_QUALITY = 0.82;

let coverStream = null;
let coverCaptured = false;

coverOpenBtn.addEventListener('click', async () => {
  try {
    coverStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (e) {
    showRecordNotice('Could not access the camera for the cover photo. Check browser permissions.');
    return;
  }
  coverVideo.srcObject = coverStream;
  await coverVideo.play();
  coverModal.hidden = false;
});

coverCancelBtn.addEventListener('click', closeCoverCamera);
coverCloseBtn.addEventListener('click', closeCoverCamera);

function closeCoverCamera() {
  if (coverStream) {
    coverStream.getTracks().forEach((t) => t.stop());
    coverStream = null;
  }
  coverModal.hidden = true;
}

// Shared by both the camera capture and the Open Library auto-fetch below,
// so *every* cover ends up the same resized/compressed size regardless of
// where it came from — a source-camera photo can be many MB, a fetched
// Open Library cover can be a multi-MB scan too.
function resizeToCoverBlob(source, sw, sh) {
  return new Promise((resolve) => {
    const scale = Math.min(1, COVER_MAX_DIMENSION / Math.max(sw, sh));
    const cw = Math.round(sw * scale);
    const ch = Math.round(sh * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    canvas.getContext('2d').drawImage(source, 0, 0, cw, ch);
    canvas.toBlob(resolve, 'image/jpeg', COVER_JPEG_QUALITY);
  });
}

function useCoverBlob(blob) {
  coverPreview.src = URL.createObjectURL(blob);
  coverPreview.hidden = false;
  coverDownloadLink.href = coverPreview.src;
  coverDownloadLink.hidden = false;
  coverCaptured = true;
  syncCoverFilename();
}

coverCaptureBtn.addEventListener('click', async () => {
  const blob = await resizeToCoverBlob(coverVideo, coverVideo.videoWidth, coverVideo.videoHeight);
  closeCoverCamera();
  useCoverBlob(blob);
});

// Tries Open Library's cover-by-ISBN endpoint after a successful ISBN
// lookup. When there's no real cover for an ISBN it doesn't 404 — it
// returns HTTP 200 with a 1x1 placeholder pixel (confirmed by hand), so
// "real cover" is detected by actual image dimensions, not response
// status. Never overrides a photo the admin already took themselves —
// their photo of the physical copy in hand is more authoritative than a
// stock cover image for the edition. If this fails or finds nothing, the
// admin can still always use Take Cover Photo — it's a bonus, not
// required.
async function tryFetchOpenLibraryCover(isbn) {
  if (coverCaptured) return;
  try {
    const res = await fetch(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`);
    if (!res.ok) return;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width <= 1 || bitmap.height <= 1) return; // the "no cover" placeholder
    const resized = await resizeToCoverBlob(bitmap, bitmap.width, bitmap.height);
    useCoverBlob(resized);
  } catch (e) {
    // network hiccup or decode failure — cover is optional, no user-facing error needed
  }
}

function syncCoverFilename() {
  if (!coverCaptured) return;
  const bookId = getRecordField('bookId').trim();
  if (bookId) {
    coverDownloadLink.download = `${bookId}.jpg`;
    coverDownloadLink.textContent = `Download cover photo (${bookId}.jpg)`;
    setRecordField('imageLink', `data/covers/${bookId}.jpg`);
  } else {
    coverDownloadLink.download = 'cover.jpg';
    coverDownloadLink.textContent = 'Download cover photo (scan QR first to name it)';
    setRecordField('imageLink', '');
  }
}
