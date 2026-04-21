import "dotenv/config";
import { createTelegramBot } from "./adapters/telegram";
import { startScheduler } from "./scheduler";
import { startAPI } from "./api/server";
import { backfill48hReminders } from "./services/reminderService";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set in environment variables");
}

const bot = createTelegramBot(token);

bot.start({
  drop_pending_updates: true,
  onStart: async (info) => {
    console.log(`✅ SportBot started as @${info.username}`);
    try {
      const { created } = await backfill48hReminders();
      console.log(`🔁 48h reminder backfill: created ${created}`);
    } catch (err) {
      console.error("48h reminder backfill failed:", err);
    }
    startScheduler(bot.api);
  },
});

// Start dashboard API (non-blocking — bot continues if API fails)
startAPI().catch((err) => {
  console.error("Dashboard API failed to start:", err);
});
