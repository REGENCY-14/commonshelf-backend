import "dotenv/config";
import express from "express";
import cors from "cors";
import apiRoutes from "./api/routes.js";
import { createBot } from "./bot/index.js";

const PORT = Number(process.env.PORT ?? 4000);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api", apiRoutes);

app.listen(PORT, () => {
  console.log(`CommonShelf backend listening on port ${PORT}`);
});

if (TELEGRAM_BOT_TOKEN) {
  const bot = createBot(TELEGRAM_BOT_TOKEN);
  bot.launch();
  console.log("Telegram bot started (long polling)");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
} else {
  console.warn("TELEGRAM_BOT_TOKEN not set — Telegram bot will not start, only the HTTP API will run.");
}
