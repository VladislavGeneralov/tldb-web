// TLDB Web — app entry point: loads data, wires state to render modules and
// user interactions (filters, table, book card, QR scan).

import { loadBooks, deriveFilterOptions } from './data.js';
import { createState, applyFilters, clearFilters } from './state.js';
import { renderFilters } from './render/filters.js';
import { renderTable } from './render/table.js';
import { renderBookCard } from './render/bookCard.js';
import { QRScanner, isScanSupported, validateTLId } from './qrScan.js';

const filtersPanel = document.getElementById('filters-panel');
const tablePanel = document.getElementById('table-panel');
const bookCard = document.getElementById('book-card');
const clearFiltersBtn = document.getElementById('clear-filters-btn');
const scanBtn = document.getElementById('scan-btn');
const scanModal = document.getElementById('scan-modal');
const scanCloseBtn = document.getElementById('scan-close-btn');
const scanVideo = document.getElementById('scan-video');
const scanStatus = document.getElementById('scan-status');

let state;
let options;
let scanner = null;

const tableCallbacks = {
  onSort(columnId) {
    if (state.sort.columnId === columnId) {
      state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      state.sort = { columnId, direction: 'asc' };
    }
    applyFilters(state);
    renderTable(tablePanel, state, tableCallbacks);
  },
  onSelectBook(bookId) {
    state.selectedBookId = bookId;
    renderTable(tablePanel, state, tableCallbacks);
    renderBookCard(bookCard, getSelectedBook());
  },
};

async function init() {
  const books = await loadBooks();
  options = deriveFilterOptions(books);
  state = createState(books);
  applyFilters(state);
  renderAll();

  clearFiltersBtn.addEventListener('click', () => {
    clearFilters(state);
    applyFilters(state);
    renderAll();
  });

  scanBtn.addEventListener('click', openScanner);
  scanCloseBtn.addEventListener('click', closeScanner);

  bookCard.addEventListener('close', () => {
    state.selectedBookId = null;
    renderTable(tablePanel, state, tableCallbacks);
    renderBookCard(bookCard, null);
  });
}

function renderAll() {
  renderFilters(filtersPanel, state, options, handleFilterChange);
  renderTable(tablePanel, state, tableCallbacks);
  renderBookCard(bookCard, getSelectedBook());
}

function handleFilterChange() {
  applyFilters(state);
  renderTable(tablePanel, state, tableCallbacks);
}

function getSelectedBook() {
  if (!state.selectedBookId) return null;
  return (
    state.results.find((b) => b.bookId === state.selectedBookId) ||
    state.allBooks.find((b) => b.bookId === state.selectedBookId) ||
    null
  );
}

async function openScanner() {
  scanModal.hidden = false;
  scanStatus.textContent = "Point the camera at a book's QR code…";

  if (!isScanSupported()) {
    scanStatus.textContent =
      "QR scanning isn't supported in this browser — try Chrome or Edge.";
    return;
  }

  scanner = new QRScanner(scanVideo);
  try {
    await scanner.start((rawValue) => handleScanResult(rawValue));
  } catch (e) {
    scanStatus.textContent = 'Could not access the camera. Check browser permissions.';
  }
}

function handleScanResult(rawValue) {
  if (!validateTLId(rawValue)) {
    scanStatus.textContent = 'THIS IS NOT A TSELINNY LIBRARY QR CODE';
    resumeScanningSoon();
    return;
  }

  const book = state.allBooks.find((b) => b.bookId === rawValue);
  if (!book) {
    scanStatus.textContent = 'THIS BOOK IS NOT IN THE DATABASE';
    resumeScanningSoon();
    return;
  }

  closeScanner();
  clearFilters(state);
  applyFilters(state);
  state.selectedBookId = book.bookId;
  renderAll();
}

function resumeScanningSoon() {
  setTimeout(() => {
    if (scanner) scanner.resume();
  }, 1500);
}

function closeScanner() {
  if (scanner) {
    scanner.stop();
    scanner = null;
  }
  scanModal.hidden = true;
}

init().catch((err) => {
  console.error(err);
  tablePanel.textContent = `Failed to load data: ${err.message}`;
});
