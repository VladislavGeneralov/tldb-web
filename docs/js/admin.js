// TLDB Web — admin panel stub.
//
// IMPORTANT: this is a placeholder gate, not real security. The password
// is a plain string sitting in this file, downloadable and readable by
// anyone via view-source — it only deters casual clicks, it does not
// protect anything. Real access control needs a backend (see project
// notes on the future admin panel) and should replace this entirely.

import { isValidIsbn13, extractIsbn13 } from './isbn.js';

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
// No catalog lookup or auto-fill here — this only validates the ISBN-13
// format/checksum, it doesn't save anything (there's no backend yet).

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
// CSS position (see .admin-isbn-guide) — video is displayed at
// width:100%/height:auto so it keeps its native aspect ratio, meaning
// these fractions map directly to pixels in the captured frame.
const GUIDE = { x: 0.075, y: 0.42, w: 0.85, h: 0.16 };
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
  isbnResult.textContent = isValidIsbn13(digits)
    ? `Valid ISBN-13: ${digits}`
    : `Not a valid ISBN-13 (bad format or checksum): "${isbnInput.value}"`;
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
    } else {
      isbnResult.textContent = `OCR read "${data.text.trim()}" — no valid ISBN in that. Read it off the preview and type it in below.`;
    }
  } catch (e) {
    isbnResult.textContent = `OCR failed (${e.message}) — type the ISBN in manually.`;
  }
}
