// TLDB Web — unified QR + ISBN scanning behind the single public SCAN
// button. Regular users can present either a book's TL QR code or its
// ISBN-13 barcode; both are read-only lookups against the loaded catalog
// (a QR match opens that exact book, an ISBN match filters the table to
// every copy sharing that ISBN) — neither ever changes the table itself.
//
// Uses the native BarcodeDetector API where the platform supports both
// formats at once (macOS/Android Chrome), falling back to the vendored
// ZXing-js (js/vendor/zxing.min.js) everywhere else — which in practice
// means everywhere, since Windows/Linux desktop Chrome/Edge don't
// implement BarcodeDetector at all. This replaced two separate decoders
// (jsQR for QR, ZXing for ISBN behind a second "(test)" button) once we
// decided regular users should scan either code from one button.
//
// A DIFFERENT, not-yet-built admin flow will reuse ZXing's ISBN decoding
// for a write workflow (scan QR to start a new record, scan ISBN to
// auto-fill it from an open book database) — see project memory. That
// needs a backend and is not this module's concern.

const TL_ID_PATTERN = /^TL\d{9}$/;
const ISBN_13_PATTERN = /^97[89]\d{10}$/;

// Without explicit resolution hints, browsers may hand back a low-res
// default stream (often 640x480) — fine for QR's built-in redundancy, not
// always enough for EAN-13's finer bar spacing. Ask for HD; "ideal" means
// the browser still gives back whatever the camera actually supports.
const VIDEO_CONSTRAINTS = {
  facingMode: 'environment',
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

export function validateTLId(id) {
  return TL_ID_PATTERN.test(id);
}

export function looksLikeIsbn13(value) {
  return ISBN_13_PATTERN.test(value);
}

export function isScanSupported() {
  return (
    'BarcodeDetector' in window ||
    (typeof window.ZXing === 'object' && !!window.ZXing.BrowserMultiFormatReader)
  );
}

const NATIVE_FORMAT_NAMES = { qr_code: 'qr_code', ean_13: 'ean_13' };

// One-shot decode of a still image (e.g. a native camera photo capture,
// not a live video stream) — a real device photo is often full sensor
// resolution with proper focus-lock, unlike any single frame sampled out
// of a getUserMedia video stream, so this is worth trying when continuous
// video scanning struggles on a given device.
export async function decodeStillImage(fileOrUrl, formats = ['ean_13']) {
  const isBlob = fileOrUrl instanceof Blob;

  if ('BarcodeDetector' in window) {
    const detector = new window.BarcodeDetector({
      formats: formats.map((f) => NATIVE_FORMAT_NAMES[f]),
    });
    const blob = isBlob ? fileOrUrl : await (await fetch(fileOrUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const codes = await detector.detect(bitmap);
    return codes.length > 0 ? codes[0].rawValue : null;
  }

  if (typeof window.ZXing === 'object') {
    const { DecodeHintType, BarcodeFormat, BrowserMultiFormatReader } = window.ZXing;
    const formatMap = { qr_code: BarcodeFormat.QR_CODE, ean_13: BarcodeFormat.EAN_13 };
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, formats.map((f) => formatMap[f]));
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints);

    const url = isBlob ? URL.createObjectURL(fileOrUrl) : fileOrUrl;
    try {
      const result = await reader.decodeFromImageUrl(url);
      return result.getText();
    } catch (e) {
      return null; // no code found in the image — not an error condition
    } finally {
      if (isBlob) URL.revokeObjectURL(url);
    }
  }

  return null;
}

export class CodeScanner {
  // formats: subset of ['qr_code', 'ean_13'] to detect. Defaults to both
  // (the public SCAN button); the admin ISBN test tool passes ['ean_13']
  // only, reusing this same tested decoder rather than duplicating it.
  constructor(videoEl, formats = ['qr_code', 'ean_13']) {
    this.videoEl = videoEl;
    this.stream = null;
    this.rafId = null;
    this.onResult = null;
    this.paused = false;
    this.zxingReader = null;

    this.nativeDetector = 'BarcodeDetector' in window
      ? new window.BarcodeDetector({ formats: formats.map((f) => NATIVE_FORMAT_NAMES[f]) })
      : null;

    if (!this.nativeDetector && typeof window.ZXing === 'object') {
      const { DecodeHintType, BarcodeFormat, BrowserMultiFormatReader } = window.ZXing;
      const formatMap = { qr_code: BarcodeFormat.QR_CODE, ean_13: BarcodeFormat.EAN_13 };
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, formats.map((f) => formatMap[f]));
      // Makes ZXing try harder per frame (more rotations/regions) at the
      // cost of speed — worth it for continuous scanning where accuracy
      // was the actual bottleneck, not frame rate. Was only ever set in
      // ad-hoc test scripts before, never in this shipped code.
      hints.set(DecodeHintType.TRY_HARDER, true);
      this.zxingReader = new BrowserMultiFormatReader(hints);
    }
  }

  async start(onResult) {
    this.onResult = onResult;

    if (this.nativeDetector) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: VIDEO_CONSTRAINTS,
      });
      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();
      this.tickNative();
      return;
    }

    if (this.zxingReader) {
      // decodeFromConstraints handles getUserMedia (with our resolution
      // hints) + its own continuous decode loop internally.
      await this.zxingReader.decodeFromConstraints(
        { video: VIDEO_CONSTRAINTS },
        this.videoEl,
        (result) => {
          if (this.paused || !result) return;
          this.onResult(result.getText());
        }
      );
    }
  }

  async tickNative() {
    if (!this.stream) return;
    try {
      const codes = await this.nativeDetector.detect(this.videoEl);
      if (codes.length > 0 && !this.paused) {
        this.onResult(codes[0].rawValue);
      }
    } catch (e) {
      // transient decode errors between frames are expected; ignore
    }
    this.rafId = requestAnimationFrame(() => this.tickNative());
  }

  // Ignore results after one's been handled but scanning should keep
  // running (e.g. an invalid/not-found code was shown to the user).
  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  stop() {
    this.paused = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.zxingReader) this.zxingReader.reset();
  }
}
