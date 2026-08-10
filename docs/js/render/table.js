// TLDB Web — renders the results table: sortable headers, rows, a visible
// copy affordance per cell, and row selection for the book detail panel.

import { COLUMNS, shortenLink } from '../data.js';
import { showToast } from '../toast.js';

export function renderTable(container, state, callbacks) {
  container.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'results-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of COLUMNS) {
    const th = document.createElement('th');
    th.textContent = col.label;
    th.tabIndex = 0;
    if (state.sort.columnId === col.id) {
      th.classList.add(state.sort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }
    th.addEventListener('click', () => callbacks.onSort(col.id));
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  if (state.results.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = COLUMNS.length;
    td.className = 'no-results';
    td.textContent = 'No matches found.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  for (const book of state.results) {
    const tr = document.createElement('tr');
    if (state.selectedBookId === book.bookId) tr.classList.add('selected');
    tr.addEventListener('click', () => callbacks.onSelectBook(book.bookId));

    for (const col of COLUMNS) {
      const td = document.createElement('td');
      const raw = book[col.id] || '';
      const display = col.isLink ? shortenLink(raw) : raw;

      const text = document.createElement('span');
      text.textContent = display;
      td.appendChild(text);

      if (raw.length > 0) {
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'copy-btn';
        copyBtn.title = 'Copy';
        copyBtn.textContent = '⧉';
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          copyToClipboard(raw);
        });
        td.appendChild(copyBtn);

        if (col.isLink) {
          const openBtn = document.createElement('button');
          openBtn.type = 'button';
          openBtn.className = 'open-btn';
          openBtn.title = 'Open';
          openBtn.textContent = '↗';
          openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(raw, '_blank', 'noopener');
          });
          td.appendChild(openBtn);
        }
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);
}

export function copyToClipboard(value) {
  navigator.clipboard.writeText(value).then(
    () => showToast('Copied'),
    () => showToast('Copy failed')
  );
}
