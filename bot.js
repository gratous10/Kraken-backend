// bot.js
const { Telegraf, Markup } = require("telegraf");

function safeText(s, maxLen = 140) {
  if (typeof s !== "string") return "";
  // Avoid huge spam + keep message tidy
  const trimmed = s.trim().replace(/\s+/g, " ");
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) + "…" : trimmed;
}

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
   * Sends 3 buttons to admin chat + requestId + submitted info (email).
   * @param {string} requestId
   * @param {{email?: string}} details
   */
  async function sendApprovalButtons(requestId, details = {}) {
    const email = safeText(details.email || "");

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("Go to page 1", `p1:${requestId}`)],
      [Markup.button.callback("Go to page 2", `p2:${requestId}`)],
      [Markup.button.callback("Reject", `rej:${requestId}`)]
    ]);

    const msg =
      `Approval needed\n` +
      `ID: ${requestId}\n` +
      (email ? `Input: ${email}` : "");

    return bot.telegram.sendMessage(adminChatId, msg, keyboard);
  }

  return { bot, sendApprovalButtons };
}

module.exports = { createBot };
