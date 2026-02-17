// bot.js (minimal)
const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || process.env.CHAT_ID;
const APP_URL = process.env.APP_URL;

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !APP_URL) {
  console.error("❌ Missing BOT_TOKEN, ADMIN_CHAT_ID/CHAT_ID, or APP_URL in environment");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

async function sendApprovalButtons(requestId, label = "New request") {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "➡️ Page 1", callback_data: `page1|${requestId}` },
          { text: "➡️ Page 2", callback_data: `page2|${requestId}` },
          { text: "❌ Reject", callback_data: `reject|${requestId}` }
        ]
      ]
    }
  };

  await bot.sendMessage(
    ADMIN_CHAT_ID,
    `🔔 *${label}*\nRequestId: \`${requestId}\``,
    { ...options, parse_mode: "Markdown" }
  );
}

bot.on("callback_query", async (query) => {
  try {
    const [action, requestId] = (query.data || "").split("|");

    let status;
    if (action === "page1") status = "page1";
    else if (action === "page2") status = "page2";
    else if (action === "reject") status = "rejected";
    else return;

    await fetch(`${APP_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, status })
    });

    await bot.editMessageText(`✅ Request \`${requestId}\` → *${status.toUpperCase()}*`, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: "Markdown"
    });

    await bot.answerCallbackQuery(query.id, { text: status.toUpperCase() });
  } catch (err) {
    console.error("❌ Callback error:", err);
    try {
      await bot.answerCallbackQuery(query.id, { text: "ERROR" });
    } catch {}
  }
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "✅ Bot is running.");
});

module.exports = { bot, sendApprovalButtons };
