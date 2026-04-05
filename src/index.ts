import "dotenv/config";
import { createTelegramBot } from "./adapters/telegram";
import { startScheduler } from "./scheduler";
import { startAPI } from "./api/server";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set in environment variables");
}

const bot = createTelegramBot(token);

bot.start({
  onStart: (info) => {
    console.log(`✅ SportBot started as @${info.username}`);
    startScheduler(bot.api);
  },
});

// Start dashboard API (non-blocking — bot continues if API fails)
startAPI().catch((err) => {
  console.error("Dashboard API failed to start:", err);
});
