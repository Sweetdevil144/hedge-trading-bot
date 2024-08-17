import { bot } from "./src/interfaces/telegram/bot";

async function main() {
  bot.start();
  console.log("Bot is running!");
}

main().catch(console.error);
