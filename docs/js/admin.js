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
import { COLUMNS, loadBooks, deriveFilterOptions } from './data.js';
import { CodeScanner, validateTLId, isScanSupported } from './codeScan.js';

const AUTH_ENDPOINT = 'https://tldb-admin-auth.ptntonesix.workers.dev/check-password';
const SESSION_KEY = 'tldb-admin-unlocked';

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
      sessionStorage.setItem(SESSION_KEY, '1');
      unlock();
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
// what the other already filled in. Nothing here writes to the real
// catalog — there's no backend — so Approve formats the current field
// values as a CSV row to paste into libraryDB.csv by hand, after
// reminding about any columns still left blank (both scans are meant to
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

loadBooks().then((books) => {
  const derived = deriveFilterOptions(books);
  PICKER_OPTIONS.languages.push(...(derived.languages || []));
  PICKER_OPTIONS.genres.push(...(derived.genres || []));

  const publishers = new Set();
  for (const b of books) {
    const v = (b.publisher || '').trim();
    if (v) publishers.add(v);
  }
  PICKER_OPTIONS.publisher.push(...[...publishers].sort((a, b) => a.localeCompare(b)));
}).catch(() => {
  // catalog failed to load — pickers just show only "Add new", still usable
});

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
      attachPicker(row, input, PICKER_OPTIONS[col.id], col.id !== 'publisher');
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

function attachPicker(wrap, input, options, multi) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'admin-picker-btn';
  btn.title = 'Pick from list';
  btn.textContent = '▾';

  const popup = document.createElement('div');
  popup.className = 'admin-picker-popup';
  popup.hidden = true;

  function currentValues() {
    return multi
      ? input.value.split(';').map((s) => s.trim()).filter(Boolean)
      : [input.value.trim()].filter(Boolean);
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
      control.type = multi ? 'checkbox' : 'radio';
      if (!multi) control.name = `picker-${input.id}`;
      control.checked = selected.includes(opt);
      control.addEventListener('change', () => {
        if (multi) {
          const set = new Set(currentValues());
          if (control.checked) set.add(opt);
          else set.delete(opt);
          input.value = [...set].join('; ');
        } else {
          input.value = opt;
          popup.hidden = true;
        }
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
      if (multi) {
        const set = new Set(currentValues());
        set.add(val);
        input.value = [...set].join('; ');
      } else {
        input.value = val;
      }
      addInput.value = '';
      renderList();
      if (!multi) popup.hidden = true;
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

    if (multi) {
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'admin-picker-done';
      doneBtn.textContent = 'Done';
      doneBtn.addEventListener('click', () => { popup.hidden = true; });
      popup.appendChild(doneBtn);
    }
  }

  btn.addEventListener('click', () => {
    popup.hidden = !popup.hidden;
    if (!popup.hidden) renderList();
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

recordApproveBtn.addEventListener('click', () => {
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
});

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
