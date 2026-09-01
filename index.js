const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
// NOTE: @neondatabase/serverless is still listed in package.json on purpose,
// even though it's not used below. Abasthan's build has repeatedly failed
// whenever the dependency LIST changed shape, but has always succeeded with
// this exact dependency set - so we're keeping package.json untouched to
// stay on a known-working build, while switching the actual storage logic
// to Firebase (a completely different network path than Neon) to test
// whether that's reachable where Neon consistently was not.

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ---------- Database setup (Firebase Realtime Database, via plain REST) ----------
// Talks to Firebase directly over HTTPS using only Node's built-in fetch and
// crypto - no extra npm packages required.
//
// Required environment variables (set in Abasthan's Environment settings):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY     (the private_key value from the service account
//                              JSON file, including the \n sequences as-is)
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

const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const FIREBASE_DATABASE_URL = (process.env.FIREBASE_DATABASE_URL || "").replace(/\/$/, "");

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedTokenExpiresAt - 60) {
    return cachedToken;
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const signingInput = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claims));
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(FIREBASE_PRIVATE_KEY);
  const jwt = signingInput + "." + base64url(signature);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpiresAt = now + (data.expires_in || 3600);
  return cachedToken;
}

async function withRetry(fn, label) {
  const delaysMs = [500, 1500, 3000];
  for (let i = 0; i < delaysMs.length; i++) {
    try {
      return await fn();
    } catch (error) {
      console.error(`${label} attempt ${i + 1} failed:`, error.message);
      await new Promise((r) => setTimeout(r, delaysMs[i]));
    }
  }
  return await fn();
}

async function firebaseGet(key) {
  return withRetry(async () => {
    const token = await getAccessToken();
    const res = await fetch(`${FIREBASE_DATABASE_URL}/storage/${encodeURIComponent(key)}.json`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Firebase GET failed: ${res.status}`);
    }
    return res.json();
  }, "DB read");
}

async function firebaseSet(key, value) {
  return withRetry(async () => {
    const token = await getAccessToken();
    const res = await fetch(`${FIREBASE_DATABASE_URL}/storage/${encodeURIComponent(key)}.json`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
    });
    if (!res.ok) {
      throw new Error(`Firebase PUT failed: ${res.status}`);
    }
    return res.json();
  }, "DB write");
}

app.use(express.json());
app.use(express.static(__dirname));

app.get("/api/storage/:key", async (req, res) => {
  const key = req.params.key;
  try {
    const value = await firebaseGet(key);
    if (value === null || value === undefined) {
      return res.status(404).json({ error: "Not found" });
    }
    res.json({ key, value });
  } catch (error) {
    console.error("DB read error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/storage/:key", async (req, res) => {
  const key = req.params.key;
  if (typeof req.body.value !== "string") {
    return res.status(400).json({ error: "Invalid value" });
  }
  try {
    await firebaseSet(key, req.body.value);
    res.json({ key, value: req.body.value });
  } catch (error) {
    console.error("DB write error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

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
