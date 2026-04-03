import "dotenv/config";
import { createTelegramBot } from "./adapters/telegram";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set in environment variables");
}

const bot = createTelegramBot(token);

bot.start({
  onStart: (info) => {
    console.log(`✅ SportBot started as @${info.username}`);
  },
});
