// TLDB Web — renders the search/filter panel and wires up its inputs.
// Text/general inputs are debounced so results update live as you type;
// selects/checkboxes fire immediately since they're discrete choices.

import { COLUMNS } from '../data.js';

let debounceTimer = null;

export function renderFilters(container, state, options, onChange) {
  container.innerHTML = '';

  const generalWrap = document.createElement('div');
  generalWrap.className = 'filter-field filter-general';
  const generalLabel = document.createElement('label');
  generalLabel.textContent = 'GENERAL SEARCH';
  generalLabel.htmlFor = 'general-search';
  const generalInput = document.createElement('input');
  generalInput.type = 'text';
  generalInput.id = 'general-search';
  generalInput.placeholder = 'Search across all fields…';
  generalInput.value = state.generalSearch;
  generalInput.addEventListener('input', () => {
    state.generalSearch = generalInput.value;
    debounce(onChange);
  });
  generalWrap.append(generalLabel, generalInput);
  container.appendChild(generalWrap);

  for (const col of COLUMNS) {
    const wrap = document.createElement('div');
    wrap.className = 'filter-field';

    const label = document.createElement('label');
    label.textContent = col.label;
    wrap.appendChild(label);

    if (col.kind === 'multiselect') {
      wrap.appendChild(renderMultiSelect(col, state, options, onChange));
    } else if (col.kind === 'singleselect') {
      wrap.appendChild(renderSingleSelect(col, state, options, onChange));
    } else {
      wrap.appendChild(renderTextInput(col, state, onChange));
    }

    container.appendChild(wrap);
  }
}

function renderTextInput(col, state, onChange) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = state.filters[col.id];
  input.placeholder = 'Filter…';
  input.addEventListener('input', () => {
    state.filters[col.id] = input.value;
    debounce(onChange);
  });
  return input;
}

function renderSingleSelect(col, state, options, onChange) {
  const select = document.createElement('select');
  const optAny = document.createElement('option');
  optAny.value = '';
  optAny.textContent = 'Any';
  select.appendChild(optAny);

  for (const val of options[col.id] || []) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    select.appendChild(opt);
  }
  select.value = state.filters[col.id] || '';
  select.addEventListener('change', () => {
    state.filters[col.id] = select.value;
    onChange();
  });
  return select;
}

function renderMultiSelect(col, state, options, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'multiselect';

  const selected = new Set(state.filters[col.id] || []);
  const values = options[col.id] || [];

  if (values.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'multiselect-empty';
    empty.textContent = '—';
    wrap.appendChild(empty);
    return wrap;
  }

  for (const val of values) {
    const item = document.createElement('label');
    item.className = 'multiselect-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(val);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(val);
      else selected.delete(val);
      state.filters[col.id] = Array.from(selected);
      onChange();
    });

    item.append(checkbox, document.createTextNode(val));
    wrap.appendChild(item);
  }

  return wrap;
}

function debounce(fn, delay = 200) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fn, delay);
}
