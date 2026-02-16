// server.js
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const cors = require("cors");
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

const app = express();

/**
 * ✅ CORS
 * This is the key fix so your hosted Render API can be called from:
 * - file:/// (origin "null")
 * - any frontend domain you host later
 */
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  })
);

app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "32kb" }));

/**
 * POST /api/submit
 * Body: { email: "..." }  (your frontend sends this)
 * Telegram: sends ONLY the buttons + requestId (no email text in Telegram).
 */
app.post("/api/submit", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Missing email" });
    }

    const requestId = uuidv4();

    store.set(requestId, {
      status: "pending",
      createdAt: Date.now()
    });

    // ✅ Send Telegram message containing ONLY 3 buttons + requestId
    await sendApprovalButtons(requestId);

    return res.json({ requestId });
  } catch (err) {
    console.error("submit error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/status/:id
 */
app.get("/api/status/:id", (req, res) => {
  const id = req.params.id;
  const record = store.get(id);
  if (!record) return res.status(404).json({ status: "not_found" });
  return res.json({ status: record.status });
});

// Optional: health check
app.get("/health", (req, res) => res.json({ ok: true }));

// ✅ Bind to 0.0.0.0 for Render
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
