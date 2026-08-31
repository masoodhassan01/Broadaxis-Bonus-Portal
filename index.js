const express = require("express");
const cors = require("cors");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ---------- Database setup ----------
// Using Neon's HTTP driver instead of a raw TCP (port 5432) connection.
// This talks to the database over HTTPS (port 443), which works even on
// networks/platforms that block or restrict raw database ports.
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://neondb_owner:npg_7cE8PWQedNGp@ep-jolly-shadow-a5663oq9-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

const sql = neon(DATABASE_URL);

// Create the storage table if it doesn't exist yet (runs once on boot).
async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS storage (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `;
}

app.use(express.json());
app.use(express.static(__dirname));

// Get stored data
app.get("/api/storage/:key", async (req, res) => {
  const key = req.params.key;

  try {
    const rows = await sql`SELECT value FROM storage WHERE key = ${key}`;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    res.json({ key, value: rows[0].value });
  } catch (error) {
    console.error("DB read error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Save stored data
app.post("/api/storage/:key", async (req, res) => {
  const key = req.params.key;

  if (typeof req.body.value !== "string") {
    return res.status(400).json({ error: "Invalid value" });
  }

  try {
    await sql`
      INSERT INTO storage (key, value) VALUES (${key}, ${req.body.value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;

    res.json({ key, value: req.body.value });
  } catch (error) {
    console.error("DB write error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Open portal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

initDb()
  .then(() => {
    console.log("Database connected and ready.");
  })
  .catch((err) => {
    console.error(
      "Database connection failed (app will still run, but storage will fail until this is fixed). Details:",
      "message=", err.message,
      "code=", err.code,
      "cause=", err.cause ? (err.cause.message || err.cause.code || String(err.cause)) : "none"
    );
  });

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// Diagnostic: test whether ANY outbound internet access works at runtime
// (not just Neon), to figure out if this is a Neon-specific issue or a
// platform-wide restriction on outbound connections.
fetch("https://api.github.com")
  .then((res) => {
    console.log("OUTBOUND TEST: SUCCESS - reached api.github.com, status:", res.status);
  })
  .catch((err) => {
    console.error("OUTBOUND TEST: FAILED - could not reach api.github.com. Error:", err.message, err.cause ? String(err.cause) : "");
  });

process.on("SIGTERM", () => {
  console.error("Process received SIGTERM (platform is killing/restarting the app).");
  process.exit(0);
});
