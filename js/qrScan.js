// TLDB Web — camera access + QR scanning. Uses the native BarcodeDetector
// API where the platform supports it (macOS/Android Chrome only — Windows,
// Linux and ChromeOS desktop Chrome/Edge don't implement it at all), and
// falls back to the vendored jsQR pure-JS decoder (js/vendor/jsQR.js,
// loaded as a plain <script> in index.html) everywhere else.

const TL_ID_PATTERN = /^TL\d{9}$/;

export function isScanSupported() {
  return 'BarcodeDetector' in window || typeof window.jsQR === 'function';
}

export function validateTLId(id) {
  return TL_ID_PATTERN.test(id);
}

export class QRScanner {
  constructor(videoEl) {
    this.videoEl = videoEl;
    this.stream = null;
    this.rafId = null;
    this.onResult = null;

    this.detector = 'BarcodeDetector' in window
      ? new window.BarcodeDetector({ formats: ['qr_code'] })
      : null;

    if (!this.detector) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
  }

  async start(onResult) {
    this.onResult = onResult;

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    this.videoEl.srcObject = this.stream;
    await this.videoEl.play();
    this.tick();
  }

  // Restarts the detection loop after a result was handled but scanning
  // should continue (e.g. an invalid/not-found code was shown to the user).
  resume() {
    if (!this.stream || this.rafId) return;
    this.tick();
  }

  async tick() {
    if (!this.stream) return;
    try {
      const rawValue = this.detector ? await this.detectNative() : this.detectWithJsQR();
      if (rawValue) {
        this.rafId = null;
        this.onResult(rawValue);
        return; // caller decides whether to stop() or resume()
      }
    } catch (e) {
      // transient decode errors are expected between frames; ignore
    }
    this.rafId = requestAnimationFrame(() => this.tick());
  }

  async detectNative() {
    const codes = await this.detector.detect(this.videoEl);
    return codes.length > 0 ? codes[0].rawValue : null;
  }

  detectWithJsQR() {
    const { videoWidth, videoHeight } = this.videoEl;
    if (!videoWidth || !videoHeight) return null;

    this.canvas.width = videoWidth;
    this.canvas.height = videoHeight;
    this.ctx.drawImage(this.videoEl, 0, 0, videoWidth, videoHeight);
    const imageData = this.ctx.getImageData(0, 0, videoWidth, videoHeight);
    const result = window.jsQR(imageData.data, imageData.width, imageData.height);
    return result ? result.data : null;
  }

  stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }
}
