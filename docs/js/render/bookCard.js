// TLDB Web — renders the book detail slide-over panel.

import { COLUMNS, shortenLink, coverImageCandidates } from '../data.js';
import { copyToClipboard } from './table.js';

export function renderBookCard(container, book) {
  container.innerHTML = '';

  if (!book) {
    container.classList.remove('open');
    container.setAttribute('aria-hidden', 'true');
    return;
  }
  container.classList.add('open');
  container.setAttribute('aria-hidden', 'false');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'book-card-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', () => container.dispatchEvent(new CustomEvent('close')));
  container.appendChild(closeBtn);

  const imgWrap = document.createElement('div');
  imgWrap.className = 'book-card-image';
  const candidates = coverImageCandidates(book.bookId);
  if (candidates.length > 0) {
    const img = document.createElement('img');
    img.alt = book.name || 'Book cover';
    let next = 0;
    const tryNextCandidate = () => {
      if (next >= candidates.length) {
        imgWrap.innerHTML = '<div class="no-image">No Image</div>';
        return;
      }
      img.src = candidates[next++];
    };
    img.addEventListener('error', tryNextCandidate);
    imgWrap.appendChild(img);
    tryNextCandidate();
  } else {
    imgWrap.innerHTML = '<div class="no-image">No Image</div>';
  }
  container.appendChild(imgWrap);

  const badges = document.createElement('div');
  badges.className = 'book-card-badges';
  if (book.status) {
    const badge = document.createElement('span');
    badge.className = `badge status-${slug(book.status)}`;
    badge.textContent = book.status;
    badges.appendChild(badge);
  }
  if (book.condition) {
    const badge = document.createElement('span');
    badge.className = 'badge condition-badge';
    badge.textContent = `Condition: ${book.condition}`;
    badges.appendChild(badge);
  }
  container.appendChild(badges);

  const fields = document.createElement('dl');
  fields.className = 'book-card-fields';
  for (const col of COLUMNS) {
    const val = book[col.id];
    if (!val) continue;

    const dt = document.createElement('dt');
    dt.textContent = col.label;

    const dd = document.createElement('dd');
    const display = col.isLink ? shortenLink(val) : val;
    const text = document.createElement('span');
    text.textContent = display;
    dd.appendChild(text);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy-btn';
    copyBtn.title = 'Copy';
    copyBtn.textContent = '⧉';
    copyBtn.addEventListener('click', () => copyToClipboard(val));
    dd.appendChild(copyBtn);

    if (col.isLink) {
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'open-btn';
      openBtn.title = 'Open';
      openBtn.textContent = '↗';
      openBtn.addEventListener('click', () => window.open(val, '_blank', 'noopener'));
      dd.appendChild(openBtn);
    }

    fields.append(dt, dd);
  }
  container.appendChild(fields);
}

function slug(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
}
