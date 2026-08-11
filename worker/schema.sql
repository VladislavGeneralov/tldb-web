CREATE TABLE IF NOT EXISTS books (
  bookId TEXT PRIMARY KEY,
  num TEXT,
  authors TEXT,
  name TEXT,
  publisher TEXT,
  year TEXT,
  isbn TEXT,
  languages TEXT,
  genres TEXT,
  condition TEXT,
  status TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  storageCell TEXT,
  qrLink TEXT,
  imageLink TEXT
);
