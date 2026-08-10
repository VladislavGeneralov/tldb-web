// TLDB Web — app state: current search/filter values, sort, results, selection.

import { COLUMNS } from './data.js';

export function createState(allBooks) {
  const filters = {};
  COLUMNS.forEach((col) => {
    filters[col.id] = col.kind === 'multiselect' ? [] : '';
  });

  return {
    allBooks,
    generalSearch: '',
    filters,
    sort: { columnId: null, direction: 'asc' },
    results: allBooks.slice(),
    selectedBookId: null,
  };
}

export function applyFilters(state) {
  const q = state.generalSearch.trim().toLowerCase();

  let results = state.allBooks.filter((book) => {
    if (q.length > 0) {
      const matchesGeneral = COLUMNS.some((col) => {
        const val = book[col.id];
        return val && val.toLowerCase().includes(q);
      });
      if (!matchesGeneral) return false;
    }

    for (const col of COLUMNS) {
      const filterValue = state.filters[col.id];
      const raw = book[col.id] || '';

      if (col.kind === 'multiselect') {
        if (!filterValue || filterValue.length === 0) continue;
        const bookValues = raw.split(';').map((s) => s.trim().toLowerCase());
        const selected = filterValue.map((v) => v.toLowerCase());
        if (!selected.some((sel) => bookValues.includes(sel))) return false;
      } else {
        const f = (filterValue || '').trim().toLowerCase();
        if (f.length === 0) continue;
        if (!raw.toLowerCase().includes(f)) return false;
      }
    }
    return true;
  });

  if (state.sort.columnId) {
    const { columnId, direction } = state.sort;
    const dir = direction === 'asc' ? 1 : -1;
    results = results.slice().sort((a, b) => {
      const av = (a[columnId] || '').toLowerCase();
      const bv = (b[columnId] || '').toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  state.results = results;
  return results;
}

export function hasActiveFilters(state) {
  if (state.generalSearch.trim().length > 0) return true;
  return Object.values(state.filters).some((v) =>
    Array.isArray(v) ? v.length > 0 : v.trim().length > 0
  );
}

export function clearFilters(state) {
  state.generalSearch = '';
  COLUMNS.forEach((col) => {
    state.filters[col.id] = col.kind === 'multiselect' ? [] : '';
  });
  state.selectedBookId = null;
}
