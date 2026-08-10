// TLDB Web — data layer: CSV loading/parsing + column schema.
// This is the single place that knows the data source is a CSV file today.
// Swapping to a real backend later means changing only loadBooks().

export const COLUMNS = [
  { id: 'num', label: '№', kind: 'text' },
  { id: 'bookId', label: 'BOOK ID', kind: 'text' },
  { id: 'authors', label: 'AUTHOR(S)', kind: 'text', multiValue: true },
  { id: 'name', label: 'BOOK NAME', kind: 'text' },
  { id: 'publisher', label: 'PUBLISHER', kind: 'text' },
  { id: 'year', label: 'YEAR', kind: 'text' },
  { id: 'languages', label: 'LANGUAGE(S)', kind: 'multiselect', multiValue: true },
  { id: 'genres', label: 'GENRE(S)', kind: 'multiselect', multiValue: true },
  { id: 'condition', label: 'CONDITION (0-5)', kind: 'singleselect' },
  { id: 'status', label: 'STATUS', kind: 'singleselect' },
  { id: 'createdAt', label: 'REC CREATION DATE', kind: 'text' },
  { id: 'updatedAt', label: 'REC UPDATE DATE', kind: 'text' },
  { id: 'storageCell', label: 'STORAGE CELL', kind: 'text' },
  { id: 'qrLink', label: 'QR LINK', kind: 'text', isLink: true },
  { id: 'imageLink', label: 'IMAGE LINK', kind: 'text', isLink: true },
];

const CSV_PATH = 'data/libraryDB.csv';

export async function loadBooks() {
  const res = await fetch(CSV_PATH);
  if (!res.ok) throw new Error(`Failed to load ${CSV_PATH}: ${res.status}`);
  const text = await res.text();
  const rows = parseCSV(text);
  if (rows.length === 0) return [];

  const header = rows[0];
  checkHeaderShape(header);

  return rows.slice(1).map((row) => {
    const book = {};
    COLUMNS.forEach((col, i) => {
      book[col.id] = (row[i] ?? '').trim();
    });
    return book;
  });
}

function checkHeaderShape(header) {
  const expected = COLUMNS.map((c) => c.label);
  const mismatch = expected.some((label, i) => (header[i] || '').trim() !== label);
  if (mismatch) {
    console.warn(
      'libraryDB.csv header does not match the expected column order. ' +
      'Expected:', expected, 'Got:', header
    );
  }
}

// Minimal RFC4180-ish CSV parser: handles quoted fields (embedded commas,
// newlines, escaped "" quotes) as well as plain comma-separated fields.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
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

export function shortenLink(full) {
  if (!full || full.length <= 12) return full || '';
  return `${full.slice(0, 5)}...${full.slice(-5)}`;
}
