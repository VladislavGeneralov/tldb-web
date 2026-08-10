// TLDB Web — camera access + QR scanning via the native BarcodeDetector API.
// Falls back to a clear "not supported" message on browsers without it
// (e.g. Safari/Firefox) rather than silently failing.

const TL_ID_PATTERN = /^TL\d{9}$/;

export function isScanSupported() {
  return 'BarcodeDetector' in window;
}

export function validateTLId(id) {
  return TL_ID_PATTERN.test(id);
}

export class QRScanner {
  constructor(videoEl) {
    this.videoEl = videoEl;
    this.stream = null;
    this.detector = isScanSupported()
      ? new window.BarcodeDetector({ formats: ['qr_code'] })
      : null;
    this.rafId = null;
    this.onResult = null;
  }

  async start(onResult) {
    this.onResult = onResult;
    if (!this.detector) return;

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
      const codes = await this.detector.detect(this.videoEl);
      if (codes.length > 0) {
        this.rafId = null;
        this.onResult(codes[0].rawValue);
        return; // caller decides whether to stop() or resume()
      }
    } catch (e) {
      // transient decode errors are expected between frames; ignore
    }
    this.rafId = requestAnimationFrame(() => this.tick());
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
