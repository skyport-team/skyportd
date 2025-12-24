const express = require("express");
const router = express.Router();
const fs = require("node:fs");

const { createDatabaseAndUser, deleteDatabaseAndUser } = require("../handlers/database.js");

// FTP Route
router.get("/ftp/info/:id", (req, res) => {
  const filePath = "./ftp/user-" + req.params.id + ".json";
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      log.error("Error reading file:", err);
      res.status(500).json({ error: "Error reading file" });
      return;
    }
    res.json(JSON.parse(data));
  });
});

// Database Route
router.post("/database/create/:name", async (req, res) => {
  try {
    const dbName = req.params.name;
    const credentials = await createDatabaseAndUser(dbName);
    res.status(200).json({
      message: `Database ${dbName} created successfully`,
      credentials,
    });
  } catch (error) {
    console.error("Error creating database:", error);
    res.status(500).json({ error: "Failed to create database" });
  }
});

router.delete("/database/delete/:name", async (req, res) => {
  try {
    const dbName = req.params.name;
    await deleteDatabaseAndUser(dbName);
    res.status(200).json({ message: `Database ${dbName} deleted successfully` });
  } catch (error) {
    console.error("Error deleting database:", error);
    res.status(500).json({ error: "Failed to delete database" });
  }
});

module.exports = router;
