// TLDB Web — admin panel stub.
//
// IMPORTANT: this is a placeholder gate, not real security. The password
// is a plain string sitting in this file, downloadable and readable by
// anyone via view-source — it only deters casual clicks, it does not
// protect anything. Real access control needs a backend (see project
// notes on the future admin panel) and should replace this entirely.

import { CodeScanner, isScanSupported, decodeStillImage } from './codeScan.js';

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

// --- SCAN ISBN test tool ---------------------------------------------
// Raw decode-and-display only: no catalog lookup, no auto-fill. Just
// proves whether the camera/decoder combo can actually read a given
// barcode, and shows exactly what it read. Reuses the same CodeScanner
// as the public SCAN button, restricted to EAN_13 only.

const isbnScanBtn = document.getElementById('admin-scan-isbn-btn');
const isbnResult = document.getElementById('admin-isbn-result');
const isbnScanModal = document.getElementById('admin-scan-modal');
const isbnScanCloseBtn = document.getElementById('admin-scan-close-btn');
const isbnScanVideo = document.getElementById('admin-scan-video');
const isbnScanStatus = document.getElementById('admin-scan-status');

let isbnScanner = null;
let lastScanText = '';

isbnScanBtn.addEventListener('click', openIsbnScanner);
isbnScanCloseBtn.addEventListener('click', closeIsbnScanner);

// Shows the camera's *actual* stream resolution once it's live — the only
// way to confirm the HD constraint in codeScan.js actually took effect on
// a given phone/browser, instead of guessing from symptoms alone.
isbnScanVideo.addEventListener('loadedmetadata', () => {
  const res = `${isbnScanVideo.videoWidth}x${isbnScanVideo.videoHeight}`;
  isbnScanStatus.textContent = lastScanText
    ? `${lastScanText} (camera: ${res})`
    : `Camera stream: ${res}. Point at an ISBN barcode…`;
});

async function openIsbnScanner() {
  isbnScanModal.hidden = false;
  lastScanText = '';
  isbnScanStatus.textContent = 'Requesting camera…';

  if (!isScanSupported()) {
    isbnScanStatus.textContent = "Scanning isn't supported in this browser — try Chrome or Edge.";
    return;
  }

  isbnScanner = new CodeScanner(isbnScanVideo, ['ean_13']);
  try {
    await isbnScanner.start((rawValue) => {
      isbnResult.textContent = `Last scanned: ${rawValue}`;
      lastScanText = `Scanned ${rawValue} — keep scanning or close.`;
      const res = `${isbnScanVideo.videoWidth}x${isbnScanVideo.videoHeight}`;
      isbnScanStatus.textContent = `${lastScanText} (camera: ${res})`;
    });
  } catch (e) {
    isbnScanStatus.textContent = 'Could not access the camera. Check browser permissions.';
  }
}

function closeIsbnScanner() {
  if (isbnScanner) {
    isbnScanner.stop();
    isbnScanner = null;
  }
  isbnScanModal.hidden = true;
}

// --- SCAN ISBN (photo) --------------------------------------------------
// Same raw decode-and-display idea, but decodes a single native camera
// photo capture instead of sampling live video frames — a real photo is
// typically full sensor resolution with proper focus-lock, unlike any one
// frame pulled out of a getUserMedia preview stream.

const isbnPhotoInput = document.getElementById('admin-isbn-photo-input');

isbnPhotoInput.addEventListener('change', async () => {
  const file = isbnPhotoInput.files[0];
  if (!file) return;

  isbnResult.textContent = `Decoding photo (${(file.size / 1024).toFixed(0)}KB)…`;
  try {
    const rawValue = await decodeStillImage(file, ['ean_13']);
    isbnResult.textContent = rawValue
      ? `Photo scan: ${rawValue}`
      : 'Photo scan: no barcode found in that photo.';
  } catch (e) {
    isbnResult.textContent = `Photo scan failed: ${e.message}`;
  }

  isbnPhotoInput.value = ''; // allow re-selecting the same file again
});
