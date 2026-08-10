// TLDB Web — ISBN-13 helpers: format/checksum validation, and pulling a
// plausible ISBN out of free-form OCR text output. Pure text logic, no
// camera/decode dependency — used by the admin capture tool and reusable
// wherever ISBN text needs checking regardless of where it came from.

const ISBN_13_FORMAT = /^97[89]\d{10}$/;

export function looksLikeIsbn13Format(digits) {
  return ISBN_13_FORMAT.test(digits);
}

export function isValidIsbn13(digits) {
  if (!looksLikeIsbn13Format(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits[12]);
}

// Slides a 13-digit window across every digit in the text (ignoring
// hyphens/spaces/"ISBN" labels etc.) looking for one that both starts
// with the Bookland prefix and passes the checksum — specific enough that
// a false positive from unrelated digits (page numbers, a price) is very
// unlikely by chance.
export function extractIsbn13(text) {
  const digits = text.replace(/[^0-9]/g, '');
  for (let i = 0; i + 13 <= digits.length; i++) {
    const candidate = digits.slice(i, i + 13);
    if (isValidIsbn13(candidate)) return candidate;
  }
  return null;
}

// Guesses the book's script/language from the ISBN registration group —
// only the groups actually relevant to this library's likely stock.
// Group "5" (right after the 978/979 Bookland prefix) is the Russian
// Federation, used broadly by Russian-language publishers across the
// former USSR; group "601" is Kazakhstan. Returns null (no guess) for
// everything else rather than pretending to know.
export function guessIsbnRegion(isbn) {
  if (/^97[89]5/.test(isbn)) return 'russian';
  if (/^978601/.test(isbn)) return 'kazakh';
  return null;
}

const CYRILLIC_PATTERN = /[Ѐ-ӿ]/;

// Open Library sometimes only has a MARC record romanized per ALA-LC
// transliteration rules (e.g. "V poiskakh poteri︠a︡nnogo zvuka" instead of
// "В поисках потерянного звука") with no Cyrillic edition anywhere for
// that ISBN — this is a source-data gap, not something a smarter query
// can fix. Detect it instead of silently handing back romanized text: if
// the ISBN's region implies non-Latin script but the looked-up text has
// no Cyrillic characters at all, it's almost certainly transliterated.
export function looksTransliterated(region, text) {
  if (!region) return false;
  return !CYRILLIC_PATTERN.test(text);
}
