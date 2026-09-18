export interface BookFormat {
  type: "epub" | "pdf" | "txt";
  url: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  year: string | null;
  language: string;
  subjects: string[];
  sourceCatalog: string;
  coverUrl: string | null;
  formats: BookFormat[];
  description: string | null;
}

export interface SearchResult {
  query: string;
  results: Book[];
}

export interface BookDetail extends Book {
  relatedBooks: Book[];
}

export type RequestSource = "telegram" | "web";
