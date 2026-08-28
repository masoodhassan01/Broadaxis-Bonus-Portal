const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
const PORT = 3000;

const DATA_FILE = path.join(__dirname, "data.json");

app.use(express.json());
app.use(express.static(__dirname));

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    console.error("Could not read data.json:", error);
    return {};
  }
}

function saveData(data) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

// Get stored data
app.get("/api/storage/:key", (req, res) => {
  const data = loadData();
  const key = req.params.key;

  if (!(key in data)) {
    return res.status(404).json({
      error: "Not found"
    });
  }

  res.json({
    key,
    value: data[key]
  });
});

// Save stored data
app.post("/api/storage/:key", (req, res) => {
  const data = loadData();
  const key = req.params.key;

  if (typeof req.body.value !== "string") {
    return res.status(400).json({
      error: "Invalid value"
    });
  }

  data[key] = req.body.value;
  saveData(data);

  res.json({
    key,
    value: data[key]
  });
});

// Open portal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});