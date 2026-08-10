// TLDB Web — TEST/EXPERIMENTAL: ISBN barcode scanning via ZXing-js
// (js/vendor/zxing.min.js, loaded as a plain <script> in index.html).
//
// This is a parallel, provisional decoder alongside the jsQR-based QR
// scanner in qrScan.js. Not yet decided whether ZXing should eventually
// replace jsQR for both QR + barcode scanning, or the two stay split —
// that's a follow-up decision, not made here.
//
// Meant for admin/staff use (looking up books by their printed ISBN),
// unlike the QR scan button which is for all users. There is no real
// access control on it — this is a static site with no backend/auth yet,
// so it's just a separately-labeled, visibly-marked "(test)" entry point
// for now rather than an actually gated admin feature.

const ISBN_13_PATTERN = /^97[89]\d{10}$/;

export function isIsbnScanSupported() {
  return typeof window.ZXing === 'object' && !!window.ZXing.BrowserMultiFormatReader;
}

export function looksLikeIsbn13(value) {
  return ISBN_13_PATTERN.test(value);
}

export class IsbnScanner {
  constructor(videoEl) {
    this.videoEl = videoEl;
    this.onResult = null;
    this.paused = false;
    this.reader = null;

    if (isIsbnScanSupported()) {
      const { DecodeHintType, BarcodeFormat, BrowserMultiFormatReader } = window.ZXing;
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]);
      this.reader = new BrowserMultiFormatReader(hints);
    }
  }

  async start(onResult) {
    this.onResult = onResult;
    if (!this.reader) return;

    // decodeFromVideoDevice handles getUserMedia + a continuous decode
    // loop internally; undefined deviceId lets it pick a default camera.
    await this.reader.decodeFromVideoDevice(undefined, this.videoEl, (result) => {
      if (this.paused || !result) return;
      this.onResult(result.getText());
    });
  }

  // Ignore decode results after a value has already been handled but
  // scanning should keep running (e.g. an invalid/not-found ISBN was
  // shown to the user) — mirrors QRScanner.resume() in qrScan.js.
  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  stop() {
    if (this.reader) this.reader.reset();
  }
}
