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

export class CodeScanner {
  constructor(videoEl) {
    this.videoEl = videoEl;
    this.stream = null;
    this.rafId = null;
    this.onResult = null;
    this.paused = false;
    this.zxingReader = null;

    this.nativeDetector = 'BarcodeDetector' in window
      ? new window.BarcodeDetector({ formats: ['qr_code', 'ean_13'] })
      : null;

    if (!this.nativeDetector && typeof window.ZXing === 'object') {
      const { DecodeHintType, BarcodeFormat, BrowserMultiFormatReader } = window.ZXing;
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13]);
      this.zxingReader = new BrowserMultiFormatReader(hints);
    }
  }

  async start(onResult) {
    this.onResult = onResult;

    if (this.nativeDetector) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();
      this.tickNative();
      return;
    }

    if (this.zxingReader) {
      // decodeFromVideoDevice handles getUserMedia + its own continuous
      // decode loop; undefined deviceId lets it pick a default camera.
      await this.zxingReader.decodeFromVideoDevice(undefined, this.videoEl, (result) => {
        if (this.paused || !result) return;
        this.onResult(result.getText());
      });
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
