import type { Book, BookDetail, BookFormat } from "../types.js";

const GUTENDEX_BASE_URL = process.env.GUTENDEX_BASE_URL ?? "https://gutendex.com";
const SOURCE_CATALOG = "Project Gutenberg";

interface GutendexAuthor {
  name: string;
  birth_year: number | null;
  death_year: number | null;
}

interface GutendexBook {
  id: number;
  title: string;
  authors: GutendexAuthor[];
  subjects: string[];
  bookshelves: string[];
  languages: string[];
  copyright: boolean | null;
  media_type: string;
  formats: Record<string, string>;
  download_count: number;
  summaries?: string[];
}

interface GutendexListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: GutendexBook[];
}

const FORMAT_TYPE_BY_MIME: Record<string, BookFormat["type"]> = {
  "application/epub+zip": "epub",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/plain; charset=utf-8": "txt",
  "text/plain; charset=us-ascii": "txt",
};

export class BookSourceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "BookSourceError";
  }
}

function extractFormats(formats: Record<string, string>): BookFormat[] {
  const seen = new Set<BookFormat["type"]>();
  const result: BookFormat[] = [];
  for (const [mime, url] of Object.entries(formats)) {
    const type = FORMAT_TYPE_BY_MIME[mime];
    if (!type || seen.has(type)) continue;
    seen.add(type);
    result.push({ type, url });
  }
  return result;
}

function extractCoverUrl(formats: Record<string, string>): string | null {
  const jpeg = Object.entries(formats).find(([mime]) => mime.startsWith("image/"));
  return jpeg ? jpeg[1] : null;
}

function toBook(raw: GutendexBook): Book {
  return {
    id: String(raw.id),
    title: raw.title,
    author: raw.authors.map((a) => a.name).join(", ") || "Unknown",
    // Gutendex has no original-publication-year field; author birth/death
    // years describe the person, not the work, so we don't fabricate one.
    year: null,
    language: raw.languages[0] ?? "en",
    subjects: raw.subjects,
    sourceCatalog: SOURCE_CATALOG,
    coverUrl: extractCoverUrl(raw.formats),
    formats: extractFormats(raw.formats),
    description: raw.summaries && raw.summaries.length > 0 ? raw.summaries[0] : null,
  };
}

const UPSTREAM_TIMEOUT_MS = 10_000;

async function fetchJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (err) {
    console.error("Gutendex fetch failed:", url, err);
    throw new BookSourceError("Failed to reach Project Gutenberg (Gutendex) API", err);
  }
  if (!response.ok) {
    console.error("Gutendex returned non-OK status:", url, response.status);
    throw new BookSourceError(`Gutendex API returned status ${response.status}`);
  }
  try {
    return (await response.json()) as T;
  } catch (err) {
    throw new BookSourceError("Gutendex API returned an unparseable response", err);
  }
}

export async function searchBooks(query: string): Promise<Book[]> {
  const url = `${GUTENDEX_BASE_URL}/books?search=${encodeURIComponent(query)}`;
  const data = await fetchJson<GutendexListResponse>(url);
  return data.results.map(toBook);
}

export async function getBookById(id: string): Promise<BookDetail | null> {
  const url = `${GUTENDEX_BASE_URL}/books/${encodeURIComponent(id)}`;
  let raw: GutendexBook;
  try {
    raw = await fetchJson<GutendexBook>(url);
  } catch (err) {
    if (err instanceof BookSourceError && err.message.includes("status 404")) {
      return null;
    }
    throw err;
  }

  const book = toBook(raw);
  const primaryAuthor = raw.authors[0]?.name;
  let relatedBooks: Book[] = [];
  if (primaryAuthor) {
    try {
      const related = await searchBooks(primaryAuthor);
      relatedBooks = related.filter((b) => b.id !== book.id).slice(0, 5);
    } catch {
      relatedBooks = [];
    }
  }

  return { ...book, relatedBooks };
}
