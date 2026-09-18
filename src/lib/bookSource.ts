import type { Book, BookDetail, BookFormat } from "../types.js";

const OPENLIBRARY_BASE_URL = process.env.OPENLIBRARY_BASE_URL ?? "https://openlibrary.org";
const ARCHIVE_BASE_URL = process.env.ARCHIVE_BASE_URL ?? "https://archive.org";
const SOURCE_CATALOG = "Internet Archive";
const SEARCH_FIELDS = "key,title,author_name,first_publish_year,language,subject,cover_i,ia";

interface OpenLibrarySearchDoc {
  key: string; // e.g. "/works/OL85892W"
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  language?: string[];
  subject?: string[];
  cover_i?: number;
  ia?: string[];
}

interface OpenLibrarySearchResponse {
  docs: OpenLibrarySearchDoc[];
}

interface OpenLibraryWork {
  description?: string | { value: string };
}

interface ArchiveFile {
  name: string;
}

interface ArchiveMetadata {
  files?: ArchiveFile[];
}

export class BookSourceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "BookSourceError";
  }
}

const UPSTREAM_TIMEOUT_MS = 10_000;

async function fetchJson<T>(url: string, serviceName: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CommonShelfBot/1.0; +https://github.com/REGENCY-14/commonshelf-backend)",
        Accept: "application/json",
      },
    });
  } catch (err) {
    console.error(`${serviceName} fetch failed:`, url, err);
    throw new BookSourceError(`Failed to reach ${serviceName}`, err);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "<unreadable body>");
    console.error(
      `${serviceName} returned non-OK status:`,
      url,
      response.status,
      "server:",
      response.headers.get("server"),
      "body:",
      body.slice(0, 500)
    );
    throw new BookSourceError(`${serviceName} returned status ${response.status}`);
  }
  try {
    return (await response.json()) as T;
  } catch (err) {
    throw new BookSourceError(`${serviceName} returned an unparseable response`, err);
  }
}

function workIdFromKey(key: string): string {
  return key.replace(/^\/works\//, "");
}

function coverUrlFromId(coverId: number | undefined): string | null {
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null;
}

/**
 * Maps a work's Internet Archive files into our normalized format list,
 * matching real, verified filenames rather than guessing a naming
 * convention — IA scans don't follow one consistent pattern.
 */
function extractArchiveFormats(iaId: string, files: ArchiveFile[]): BookFormat[] {
  const found: Partial<Record<BookFormat["type"], string>> = {};
  for (const file of files) {
    const name = file.name ?? "";
    if (!found.epub && /\.epub$/i.test(name)) found.epub = name;
    else if (!found.pdf && /\.pdf$/i.test(name) && !/_bw\.pdf$/i.test(name)) found.pdf = name;
    else if (!found.txt && /_djvu\.txt$/i.test(name)) found.txt = name;
  }
  const order: BookFormat["type"][] = ["epub", "pdf", "txt"];
  return order
    .filter((type) => found[type])
    .map((type) => ({ type, url: `${ARCHIVE_BASE_URL}/download/${iaId}/${found[type]}` }));
}

function toBook(doc: OpenLibrarySearchDoc, formats: BookFormat[] = []): Book {
  return {
    id: workIdFromKey(doc.key),
    title: doc.title,
    author: doc.author_name?.join(", ") ?? "Unknown",
    year: doc.first_publish_year ? String(doc.first_publish_year) : null,
    language: doc.language?.[0] ?? "en",
    subjects: doc.subject?.slice(0, 8) ?? [],
    sourceCatalog: SOURCE_CATALOG,
    coverUrl: coverUrlFromId(doc.cover_i),
    formats,
    description: null,
  };
}

async function searchDocs(query: string): Promise<OpenLibrarySearchDoc[]> {
  const url = `${OPENLIBRARY_BASE_URL}/search.json?q=${encodeURIComponent(query)}&fields=${SEARCH_FIELDS}&limit=20`;
  const data = await fetchJson<OpenLibrarySearchResponse>(url, "Open Library");
  // Only keep works with a real Internet Archive copy — this is a catalog
  // of readable books, not just bibliographic records.
  return data.docs.filter((doc) => doc.ia && doc.ia.length > 0);
}

export async function searchBooks(query: string): Promise<Book[]> {
  const docs = await searchDocs(query);
  return docs.map((doc) => toBook(doc));
}

async function fetchDescription(workId: string): Promise<string | null> {
  try {
    const work = await fetchJson<OpenLibraryWork>(`${OPENLIBRARY_BASE_URL}/works/${workId}.json`, "Open Library");
    if (typeof work.description === "string") return work.description;
    return work.description?.value ?? null;
  } catch {
    return null;
  }
}

export async function getBookById(id: string): Promise<BookDetail | null> {
  const url = `${OPENLIBRARY_BASE_URL}/search.json?q=${encodeURIComponent(`key:/works/${id}`)}&fields=${SEARCH_FIELDS}&limit=1`;
  const data = await fetchJson<OpenLibrarySearchResponse>(url, "Open Library");
  const doc = data.docs[0];
  if (!doc) return null;

  const iaId = doc.ia?.[0];
  let formats: BookFormat[] = [];
  if (iaId) {
    try {
      const meta = await fetchJson<ArchiveMetadata>(
        `${ARCHIVE_BASE_URL}/metadata/${encodeURIComponent(iaId)}`,
        "Internet Archive"
      );
      formats = extractArchiveFormats(iaId, meta.files ?? []);
    } catch {
      formats = [];
    }
  }

  const [description, relatedBooks] = await Promise.all([
    fetchDescription(id),
    (async () => {
      const primaryAuthor = doc.author_name?.[0];
      if (!primaryAuthor) return [];
      try {
        const related = await searchBooks(primaryAuthor);
        return related.filter((b) => b.id !== id).slice(0, 5);
      } catch {
        return [];
      }
    })(),
  ]);

  return { ...toBook(doc, formats), description, relatedBooks };
}
