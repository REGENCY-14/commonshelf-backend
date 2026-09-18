import { Telegraf } from "telegraf";
import { searchBooks, BookSourceError } from "../lib/bookSource.js";
import { logSearch } from "../db/index.js";
import type { Book } from "../types.js";

function formatBookLine(book: Book): string {
  const formats = book.formats.map((f) => `[${f.type}](${f.url})`).join(" | ");
  const year = book.year ? ` (${book.year})` : "";
  return `*${book.title}*${year} — ${book.author}\n${formats || "No downloadable formats found"}`;
}

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  bot.start((ctx) =>
    ctx.reply(
      "Welcome to CommonShelf! Send me a book title or author and I'll find a legal, public-domain copy from Project Gutenberg."
    )
  );

  bot.help((ctx) =>
    ctx.reply("Just type a book title or author name to search Project Gutenberg.")
  );

  bot.on("text", async (ctx) => {
    const query = ctx.message.text.trim();
    if (!query || query.startsWith("/")) return;

    try {
      const results = await searchBooks(query);
      logSearch({ query, source: "telegram", resultCount: results.length, telegramChatId: ctx.chat.id });

      if (results.length === 0) {
        await ctx.reply(`No results found for "${query}".`);
        return;
      }

      const top = results.slice(0, 5);
      const message = top.map(formatBookLine).join("\n\n");
      await ctx.replyWithMarkdown(message);
    } catch (err) {
      if (err instanceof BookSourceError) {
        await ctx.reply("Sorry, I couldn't reach the book catalog. Please try again shortly.");
        return;
      }
      await ctx.reply("Something went wrong with that search.");
    }
  });

  return bot;
}
