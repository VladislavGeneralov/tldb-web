// TLDB Web — data layer: catalog loading (Cloudflare Worker + D1) + column
// schema. This is the single place that knows where book data comes from —
// originally a static CSV, now the tldb-admin-auth Worker's /books endpoint
// (see worker/src/index.js), which is the live source of truth. The CSV
// file (data/libraryDB.csv) stays in the repo as a point-in-time snapshot
// but is no longer read by the running site.

export const COLUMNS = [
  { id: 'num', label: '№', kind: 'text', numeric: true },
  { id: 'bookId', label: 'BOOK ID', kind: 'text' },
  { id: 'authors', label: 'AUTHOR(S)', kind: 'text', multiValue: true },
  { id: 'name', label: 'BOOK NAME', kind: 'text' },
  { id: 'publisher', label: 'PUBLISHER', kind: 'text' },
  { id: 'year', label: 'YEAR', kind: 'text', numeric: true },
  { id: 'isbn', label: 'ISBN', kind: 'text' },
  { id: 'languages', label: 'LANGUAGE(S)', kind: 'multiselect', multiValue: true },
  { id: 'genres', label: 'GENRE(S)', kind: 'multiselect', multiValue: true },
  { id: 'condition', label: 'CONDITION (0-5)', kind: 'singleselect', numeric: true },
  { id: 'status', label: 'STATUS', kind: 'singleselect' },
  { id: 'createdAt', label: 'REC CREATION DATE', kind: 'text' },
  { id: 'updatedAt', label: 'REC UPDATE DATE', kind: 'text' },
  { id: 'storageCell', label: 'STORAGE CELL', kind: 'text' },
  { id: 'qrLink', label: 'QR LINK', kind: 'text', isLink: true },
  { id: 'imageLink', label: 'IMAGE LINK', kind: 'text', isLink: true },
];

export const BOOKS_API_URL = 'https://tldb-admin-auth.ptntonesix.workers.dev/books';

export async function loadBooks() {
  const res = await fetch(BOOKS_API_URL);
  if (!res.ok) throw new Error(`Failed to load books: ${res.status}`);
  const data = await res.json();
  return (data.books || []).map((row) => {
    const book = {};
    for (const col of COLUMNS) book[col.id] = (row[col.id] ?? '').trim();
    return book;
  });
}

export function splitMulti(value) {
  if (!value) return [];
  return value.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
}

// Derives dropdown option lists for multiselect/singleselect columns from
// whatever data is actually loaded (fixture today, real data later) rather
// than hardcoding a canonical enum — the source CSV may still contain
// inconsistent values (e.g. typo'd STATUS) that a future backend should
// validate against a real enum instead of the UI silently accepting them.
export function deriveFilterOptions(books) {
  const options = {};
  for (const col of COLUMNS) {
    if (col.kind !== 'multiselect' && col.kind !== 'singleselect') continue;
    const set = new Set();
    for (const book of books) {
      const raw = book[col.id];
      const values = col.multiValue ? splitMulti(raw) : (raw ? [raw.trim()] : []);
      values.forEach((v) => v && set.add(v));
    }
    options[col.id] = Array.from(set).sort((a, b) => a.localeCompare(b));
  }
  return options;
}

// Cover photos are stored locally under data/covers/<BOOK ID>.jpg — keyed
// by BOOK ID rather than trusting the CSV's IMAGE LINK column, which holds
// an absolute Windows path from the original desktop app that can't resolve
// in a browser. All covers are normalized to compressed .jpg on import (see
// the compress step in project notes); callers should fall back to a
// placeholder if this 404s.
export function coverImageCandidates(bookId) {
  if (!bookId) return [];
  return [`data/covers/${bookId}.jpg`];
}

export function shortenLink(full) {
  if (!full || full.length <= 12) return full || '';
  return `${full.slice(0, 5)}...${full.slice(-5)}`;
}
