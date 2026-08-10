// TLDB Web — admin panel stub.
//
// IMPORTANT: this is a placeholder gate, not real security. The password
// is a plain string sitting in this file, downloadable and readable by
// anyone via view-source — it only deters casual clicks, it does not
// protect anything. Real access control needs a backend (see project
// notes on the future admin panel) and should replace this entirely.

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
