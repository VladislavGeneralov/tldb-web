// TLDB Web — admin panel stub.
//
// IMPORTANT: this is a placeholder gate, not real security. The password
// is a plain string sitting in this file, downloadable and readable by
// anyone via view-source — it only deters casual clicks, it does not
// protect anything. Real access control needs a backend (see project
// notes on the future admin panel) and should replace this entirely.

import { isValidIsbn13, extractIsbn13, guessIsbnRegion, looksTransliterated } from './isbn.js';
import { lookupIsbn } from './isbnLookup.js';
import { COLUMNS } from './data.js';
import { CodeScanner, validateTLId, isScanSupported } from './codeScan.js';

const ADMIN_PASSWORD = 'TLDBadmin00';
const SESSION_KEY = 'tldb-admin-unlocked';

const gate = document.getElementById('admin-gate');
const gateForm = document.getElementById('admin-gate-form');
const gateInput = document.getElementById('admin-gate-input');
const gateError = document.getElementById('admin-gate-error');
const panel = document.getElementById('admin-panel');

function unlock() {
  gate.hidden = true;
  panel.hidden = false;
}

if (sessionStorage.getItem(SESSION_KEY) === '1') {
  unlock();
}

gateForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (gateInput.value === ADMIN_PASSWORD) {
    sessionStorage.setItem(SESSION_KEY, '1');
    unlock();
  } else {
    gateError.textContent = 'Incorrect password.';
    gateInput.value = '';
    gateInput.focus();
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

    wrap.appendChild(input);
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

// --- Take Cover Photo -----------------------------------------------------
// No backend to upload to, so this can't save into data/covers/ directly —
// browsers can't write to the site's own files. Instead: capture, resize
// to the same convention the real catalog's covers already use (max
// ~800px, JPEG ~82% — see project notes on compressing the 60 real
// covers), offer it as a download, and set IMAGE LINK to the path it
// *should* live at once someone drops the downloaded file into
// data/covers/ by hand. The filename/path depend on BOOK ID, which might
// not be scanned yet — kept in sync via syncCoverFilename(), called again
// whenever BOOK ID changes after a cover's already been captured.

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

coverCaptureBtn.addEventListener('click', () => {
  const vw = coverVideo.videoWidth;
  const vh = coverVideo.videoHeight;
  const scale = Math.min(1, COVER_MAX_DIMENSION / Math.max(vw, vh));
  const cw = Math.round(vw * scale);
  const ch = Math.round(vh * scale);

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext('2d').drawImage(coverVideo, 0, 0, cw, ch);

  closeCoverCamera();

  canvas.toBlob((blob) => {
    coverPreview.src = URL.createObjectURL(blob);
    coverPreview.hidden = false;
    coverDownloadLink.href = coverPreview.src;
    coverDownloadLink.hidden = false;
    coverCaptured = true;
    syncCoverFilename();
  }, 'image/jpeg', COVER_JPEG_QUALITY);
});

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
