const express = require("express");
const cors = require("cors");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ---------- Database setup ----------
// Using Neon's HTTP driver (works over HTTPS, not raw Postgres ports).
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://neondb_owner:npg_7cE8PWQedNGp@ep-jolly-shadow-a5663oq9-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

const sql = neon(DATABASE_URL);

// Neon's free-tier compute auto-suspends after a period of inactivity and
// needs a few seconds to wake back up. Retry a few times with increasing
// delay before giving up, so a sleeping database doesn't turn into a hard
// error for the person using the app.
async function queryWithRetry(fn, label) {
  const delaysMs = [500, 1500, 3000, 5000];
  for (let i = 0; i < delaysMs.length; i++) {
    try {
      return await fn();
    } catch (error) {
      console.error(`${label} attempt ${i + 1} failed:`, error.message);
      await new Promise((r) => setTimeout(r, delaysMs[i]));
    }
  }
  return await fn(); // final attempt: let it throw for the route's catch block
}

// Create the storage table if it doesn't exist yet (runs once on boot).
async function initDb() {
  await queryWithRetry(
    () => sql`
      CREATE TABLE IF NOT EXISTS storage (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
    "initDb"
  );
}

app.use(express.json());
app.use(express.static(__dirname));

// Get stored data
app.get("/api/storage/:key", async (req, res) => {
  const key = req.params.key;

  try {
    const rows = await queryWithRetry(
      () => sql`SELECT value FROM storage WHERE key = ${key}`,
      "DB read"
    );

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
    await queryWithRetry(
      () => sql`
        INSERT INTO storage (key, value) VALUES (${key}, ${req.body.value})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `,
      "DB write"
    );

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
  .then(() => console.log("Database connected and ready."))
  .catch((err) => console.error("Database connection failed on boot:", err.message));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

process.on("SIGTERM", () => {
  console.error("Process received SIGTERM (platform is killing/restarting the app).");
  process.exit(0);
});
