/**
 * Web Server
 * ===========
 * Express server that serves the frontend UI and exposes
 * an SSE endpoint for real-time scrape progress.
 *
 * Usage: node server.js
 */

require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const { runScrape } = require("./scraper-engine");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Serve exported CSV files for download
const exportsDir = path.join(__dirname, "exports");
if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
app.use("/exports", express.static(exportsDir));

// Track active scrape to prevent concurrent runs
let isRunning = false;

// ── API: Start Scrape (SSE stream) ────────────────────────────
app.get("/api/scrape", async (req, res) => {
  // Validate API key is configured
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
    return res.status(500).json({ error: "Google Maps API key is not configured in .env" });
  }

  if (isRunning) {
    return res.status(429).json({ error: "A scrape is already in progress. Please wait." });
  }

  // Parse query params
  const query = req.query.query || "coaching centres";
  const location = req.query.location || "Pune,India";
  const radius = Math.min(Math.max(parseInt(req.query.radius) || 5000, 500), 50000);
  const maxResults = Math.min(Math.max(parseInt(req.query.maxResults) || 60, 1), 300);

  // Set up SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (eventName, data) => {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  isRunning = true;
  sendEvent("start", { query, location, radius, maxResults });

  try {
    const { results, summary, csvFilename } = await runScrape({
      query,
      location,
      radius,
      maxResults,
      onProgress: (info) => {
        sendEvent("progress", info);
      },
    });

    sendEvent("complete", {
      summary,
      csvDownloadUrl: `/exports/${csvFilename}`,
      results,
    });
  } catch (err) {
    sendEvent("error", { message: err.message });
  } finally {
    isRunning = false;
    res.end();
  }
});

// ── API: Check status ──────────────────────────────────────────
app.get("/api/status", (req, res) => {
  res.json({ running: isRunning });
});

// ── Fallback to index.html (SPA) ──────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Maps Scraper UI ready at: http://localhost:${PORT}\n`);
});
