// TLDB Web — tiny toast notification helper (used for copy confirmations).

let toastEl = null;
let hideTimer = null;

export function showToast(message) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => toastEl.classList.remove('visible'), 1500);
}
