// TLDB Web — ISBN-13 metadata lookup against Open Library, for the admin
// "new record" draft form. Just this one source, deliberately: it needs
// no API key and hit no rate limit in testing, unlike Google Books, which
// returned a 429 quota-exceeded on the very first anonymous test call
// this project made — not reliable enough to depend on. Confirmed (see
// project notes) to allow direct client-side fetch() with no CORS issue.
//
// Coverage is genuinely partial for this library's catalog: works well
// for internationally-distributed English-language books, poorly for
// Russian translated editions and small regional art-press titles.
// Treat any result as a draft to review, never assume it's correct.

export async function lookupIsbn(isbn) {
  const res = await fetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
  );
  if (!res.ok) return null;
  const data = await res.json();
  const book = data[`ISBN:${isbn}`];
  if (!book) return null;

  return {
    title: book.title || '',
    authors: (book.authors || []).map((a) => a.name).join('; '),
    publisher: (book.publishers || []).map((p) => p.name).join('; '),
    year: extractYear(book.publish_date),
  };
}

function extractYear(dateStr) {
  const match = String(dateStr || '').match(/\d{4}/);
  return match ? match[0] : '';
}
