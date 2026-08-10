// TLDB Web — app entry point: loads data, wires state to render modules and
// user interactions (filters, table, book card, QR scan).

import { loadBooks, deriveFilterOptions } from './data.js';
import { createState, applyFilters, clearFilters } from './state.js';
import { renderFilters } from './render/filters.js';
import { renderTable } from './render/table.js';
import { renderBookCard } from './render/bookCard.js';
import { QRScanner, isScanSupported, validateTLId } from './qrScan.js';
import { IsbnScanner, isIsbnScanSupported, looksLikeIsbn13 } from './isbnScan.js';

const filtersPanel = document.getElementById('filters-panel');
const tablePanel = document.getElementById('table-panel');
const bookCard = document.getElementById('book-card');
const clearFiltersBtn = document.getElementById('clear-filters-btn');
const scanBtn = document.getElementById('scan-btn');
const isbnScanBtn = document.getElementById('isbn-scan-btn');
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

  scanBtn.addEventListener('click', () => openScanner('qr'));
  isbnScanBtn.addEventListener('click', () => openScanner('isbn'));
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

async function openScanner(mode) {
  scanModal.hidden = false;

  if (mode === 'isbn') {
    scanStatus.textContent = "(test) Point the camera at a book's ISBN barcode…";

    if (!isIsbnScanSupported()) {
      scanStatus.textContent = 'ISBN scanning failed to load (ZXing-js unavailable).';
      return;
    }

    scanner = new IsbnScanner(scanVideo);
    try {
      await scanner.start((rawValue) => handleIsbnScanResult(rawValue));
    } catch (e) {
      scanStatus.textContent = 'Could not access the camera. Check browser permissions.';
    }
    return;
  }

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

// TEST/EXPERIMENTAL — see isbnScan.js. Only looks up an existing catalog
// entry by its ISBN column; doesn't auto-fill anything (that needs a
// backend, not built yet).
function handleIsbnScanResult(rawValue) {
  if (!looksLikeIsbn13(rawValue)) {
    scanStatus.textContent = '(test) NOT A VALID ISBN-13 BARCODE';
    resumeScanningSoon();
    return;
  }

  // Unlike BOOK ID (one QR = exactly one physical copy), an ISBN identifies
  // an edition — the library can hold multiple copies sharing the same
  // ISBN. Only auto-open a book card when the match is unambiguous;
  // otherwise leave the filtered list for a human to pick the right copy.
  const matches = state.allBooks.filter(
    (b) => b.isbn && b.isbn.replace(/[-\s]/g, '') === rawValue
  );
  if (matches.length === 0) {
    scanStatus.textContent = '(test) NO BOOK WITH THIS ISBN IN THE DATABASE';
    resumeScanningSoon();
    return;
  }

  closeScanner();
  clearFilters(state);
  state.filters.isbn = rawValue;
  applyFilters(state);
  if (matches.length === 1) {
    state.selectedBookId = matches[0].bookId;
  }
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
