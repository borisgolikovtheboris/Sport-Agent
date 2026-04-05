import { MyContext } from "../index";

export async function dashboardCommand(ctx: MyContext) {
  const adminId = process.env.ADMIN_USER_ID;

  if (ctx.chat?.type !== "private") {
    await ctx.reply("Эта команда работает только в личке.");
    return;
  }

  if (!adminId || String(ctx.from?.id) !== adminId) {
    await ctx.reply("Команда доступна только администратору бота.");
    return;
  }

  const dashboardKey = process.env.DASHBOARD_KEY;
  const port = process.env.DASHBOARD_PORT || "3000";
  const baseUrl = process.env.DASHBOARD_URL || `http://localhost:${port}`;
  const url = `${baseUrl}/dashboard?key=${dashboardKey}`;

  await ctx.reply(`📊 Дашборд SportBot:\n${url}`, {
    link_preview_options: { is_disabled: true },
  });
}
