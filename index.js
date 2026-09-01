const express = require("express");
const cors = require("cors");
const path = require("path");
const admin = require("firebase-admin");

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ---------- Database setup (Firebase Realtime Database) ----------
// Credentials come from environment variables set in Abasthan's dashboard
// (Settings -> Environment), never hardcoded here, so the real key never
// ends up in GitHub.
//
// Required environment variables:
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY     (paste the private_key value from the JSON file;
//                              this code handles the \n escaping for you)
//   FIREBASE_DATABASE_URL    (e.g. https://bonus-portal-99e6d-default-rtdb.firebaseio.com)

const requiredEnvVars = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_DATABASE_URL",
];
const missingEnvVars = requiredEnvVars.filter((name) => !process.env[name]);
if (missingEnvVars.length > 0) {
  console.error(
    "Missing required Firebase environment variables:",
    missingEnvVars.join(", "),
    "- set these in Abasthan's Environment settings."
  );
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // Environment variables can't store real newlines, so the key is stored
    // with literal "\n" text and converted back to real newlines here.
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();

// Retry helper: Firebase is generally reliable and doesn't sleep like a
// free-tier Postgres compute does, but a brief retry still helps ride out
// any momentary network hiccup rather than surfacing a hard error.
async function queryWithRetry(fn, label) {
  const delaysMs = [500, 1500, 3000];
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

app.use(express.json());
app.use(express.static(__dirname));

// Get stored data
app.get("/api/storage/:key", async (req, res) => {
  const key = req.params.key;

  try {
    const snapshot = await queryWithRetry(
      () => db.ref(`storage/${key}`).once("value"),
      "DB read"
    );

    if (!snapshot.exists()) {
      return res.status(404).json({ error: "Not found" });
    }

    res.json({ key, value: snapshot.val() });
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
      () => db.ref(`storage/${key}`).set(req.body.value),
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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

process.on("SIGTERM", () => {
  console.error("Process received SIGTERM (platform is killing/restarting the app).");
  process.exit(0);
});
