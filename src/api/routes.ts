import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { searchBooks, getBookById, BookSourceError } from "../lib/bookSource.js";
import { logSearch } from "../db/index.js";

const router = Router();

const apiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Too many requests. Please try again shortly." },
});

router.use(apiRateLimit);

const searchBodySchema = z.object({
  query: z.string().trim().min(1, "query must not be empty").max(200, "query is too long"),
  source: z.literal("web"),
});

router.post("/search", async (req: Request, res: Response) => {
  const parsed = searchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_request",
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
    });
  }

  const { query } = parsed.data;

  try {
    const results = await searchBooks(query);
    logSearch({ query, source: "web", resultCount: results.length });
    return res.json({ query, results });
  } catch (err) {
    if (err instanceof BookSourceError) {
      return res.status(502).json({
        error: "upstream_error",
        message: "Could not reach the book catalog. Please try again shortly.",
      });
    }
    return res.status(500).json({ error: "internal_error", message: "Something went wrong." });
  }
});

const bookIdParamSchema = z.object({
  id: z.string().trim().regex(/^[a-zA-Z0-9_-]+$/, "invalid book id"),
});

router.get("/books/:id", async (req: Request, res: Response) => {
  const parsed = bookIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_request",
      message: parsed.error.issues[0]?.message ?? "Invalid book id",
    });
  }

  try {
    const book = await getBookById(parsed.data.id);
    if (!book) {
      return res.status(404).json({ error: "not_found", message: "Book not found." });
    }
    return res.json(book);
  } catch (err) {
    if (err instanceof BookSourceError) {
      return res.status(502).json({
        error: "upstream_error",
        message: "Could not reach the book catalog. Please try again shortly.",
      });
    }
    return res.status(500).json({ error: "internal_error", message: "Something went wrong." });
  }
});

export default router;
