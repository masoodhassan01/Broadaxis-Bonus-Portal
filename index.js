const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ---------- Database setup ----------
// Prefer an environment variable if it's set (best practice), but fall
// back to this hardcoded connection string so deployment works even
// without configuring Abasthan's Environment Variables UI.
// NOTE: this repo is private, which is why hardcoding this is acceptable here.
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://neondb_owner:npg_7cE8PWQedNGp@ep-jolly-shadow-a5663oq9-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 4000,
});

// Create the storage table if it doesn't exist yet (runs once on boot).
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS storage (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

app.use(express.json());
app.use(express.static(__dirname));

// Get stored data
app.get("/api/storage/:key", async (req, res) => {
  const key = req.params.key;

  try {
    const result = await pool.query(
      "SELECT value FROM storage WHERE key = $1",
      [key]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    res.json({ key, value: result.rows[0].value });
  } catch (error) {
    console.error("DB read error:", error);
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
    await pool.query(
      `INSERT INTO storage (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, req.body.value]
    );

    res.json({ key, value: req.body.value });
  } catch (error) {
    console.error("DB write error:", error);
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
      "errno=", err.errno,
      "syscall=", err.syscall
    );
  });

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

process.on("SIGTERM", () => {
  console.error("Process received SIGTERM (platform is killing/restarting the app).");
  process.exit(0);
});
