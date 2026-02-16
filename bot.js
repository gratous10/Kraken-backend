// bot.js
// Telegraf v4 approval bot: sends ONLY 3 buttons, no user data in Telegram.
//
// Expected store shape:
// store = new Map();
// store.set(requestId, { status: 'pending'|'page1'|'page2'|'rejected', createdAt: Date.now() });

const { Telegraf, Markup } = require("telegraf");

function createBot({ botToken, adminChatId, store }) {
  if (!botToken) throw new Error("BOT_TOKEN missing");
  if (!adminChatId) throw new Error("ADMIN_CHAT_ID missing");
  if (!store) throw new Error("store Map missing");

  const bot = new Telegraf(botToken);

  bot.start((ctx) => {
    ctx.reply("✅ Bot is running. You will receive approval buttons here.");
  });

  // Handle button presses: action:requestId
  bot.on("callback_query", async (ctx) => {
    try {
      const data = ctx.callbackQuery?.data || "";
      const [action, requestId] = data.split(":");

      if (!action || !requestId) {
        await ctx.answerCbQuery("Invalid action.");
        return;
      }

      const record = store.get(requestId);
      if (!record) {
        await ctx.answerCbQuery("Request not found/expired.");
        return;
      }

      if (record.status !== "pending") {
        await ctx.answerCbQuery(`Already ${record.status}.`);
        return;
      }

      if (action === "p1") record.status = "page1";
      else if (action === "p2") record.status = "page2";
      else if (action === "rej") record.status = "rejected";
      else {
        await ctx.answerCbQuery("Unknown action.");
        return;
      }

      store.set(requestId, record);

      const decisionText =
        record.status === "page1"
          ? "✅ Approved: Page 1"
          : record.status === "page2"
            ? "✅ Approved: Page 2"
            : "❌ Rejected";

      // Update the message so you can see what you chose
      const originalText = ctx.callbackQuery.message?.text || "Approval request";
      await ctx.editMessageText(`${originalText}\n\n${decisionText}`);

      await ctx.answerCbQuery("Saved.");
    } catch (err) {
      console.error("callback_query error:", err);
      try {
        await ctx.answerCbQuery("Error.");
      } catch {}
    }
  });

  /**
   * Sends ONLY the 3 buttons to the admin chat.
   * @param {string} requestId - unique id created by your backend for each submission
   */
  async function sendApprovalButtons(requestId) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("Go to page 1", `p1:${requestId}`)],
      [Markup.button.callback("Go to page 2", `p2:${requestId}`)],
      [Markup.button.callback("Reject", `rej:${requestId}`)]
    ]);

    // Message contains no sensitive data—just a request ID.
    return bot.telegram.sendMessage(
      adminChatId,
      `Approval needed\nID: ${requestId}`,
      keyboard
    );
  }

  return { bot, sendApprovalButtons };
}

module.exports = { createBot };
