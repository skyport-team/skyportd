const express = require("express");
const router = express.Router();
const fs = require("fs").promises;
const path = require("path");
const { safePath } = require("../utils/SafePath");
const {
  getFilePurpose,
  isEditable,
  formatFileSize,
  calculateDirectorySize,
} = require("../utils/FileType");

/**
 * GET /:id/files
 * Retrieves a list of files and directories within a specified volume, optionally within a subdirectory.
 * Provides enhanced details about each file or directory, including its type, editability, size, last updated timestamp, and purpose.
 *
 * @param {string} id - The volume identifier.
 * @param {string} [path] - Optional. A subdirectory within the volume to list files from.
 * @returns {Response} JSON response containing detailed information about files within the specified path.
 */
router.get("/fs/:id/files", async (req, res) => {
  const volumeId = req.params.id;
  const subPath = req.query.path || "";
  const volumesPath = path.join(__dirname, "../volumes");
  const volumePath = path.join(volumesPath, volumeId);

  if (!volumeId) return res.status(400).json({ message: "No volume ID" });

  try {
    const filePath = safePath(volumePath, subPath);
    const files = await fs.readdir(filePath, { withFileTypes: true });

    const detailedFiles = await Promise.all(
      files.map(async (file) => {
        const fileFullPath = path.join(filePath, file.name);
        const stats = await fs.stat(fileFullPath);
        let size;

        if (file.isDirectory()) {
          const dirSize = await calculateDirectorySize(fileFullPath);
          size = formatFileSize(dirSize);
        } else {
          size = formatFileSize(stats.size);
        }

        return {
          name: file.name,
          isDirectory: file.isDirectory(),
          isEditable: isEditable(file.name),
          size: size,
          lastUpdated: stats.mtime.toISOString(),
          purpose: file.isDirectory() ? "folder" : getFilePurpose(file.name),
          extension: path.extname(file.name).toLowerCase(),
          permissions: stats.mode.toString(8).slice(-3), // Unix-style permissions
        };
      })
    );

    res.json({ files: detailedFiles });
  } catch (err) {
    if (err.message.includes("Attempting to access outside of the volume")) {
      res.status(400).json({ message: err.message });
    } else if (err.code === 'ENOENT') {
      res.status(404).json({ message: 'Volume or directory not found' });
    } else {
      res.status(500).json({ message: err.message });
    }
  }
});


async function recursiveSearch(dir, query, baseDir) {
  let results = [];
  try {
    const files = await fs.readdir(dir, { withFileTypes: true });

    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        results = results.concat(await recursiveSearch(fullPath, query, baseDir));
      } else {
        if (file.name.toLowerCase().includes(query.toLowerCase())) {
          const stats = await fs.stat(fullPath);
          const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
          
          results.push({
            name: relativePath,
            size: formatFileSize(stats.size),
            lastUpdated: stats.mtime.toISOString(),
            purpose: getFilePurpose(file.name),
            isDirectory: false
          });
        }
      }
    }
  } catch (err) {
    console.error(`Error searching in ${dir}: ${err.message}`);
  }
  return results;
}

router.get("/fs/:id/search", async (req, res) => {
  const volumeId = req.params.id;
  const query = req.query.q;

  if (!volumeId || !query) {
    return res.status(400).json({ message: "Missing volume ID or query" });
  }

  const volumesPath = path.join(__dirname, "../volumes");
  const volumePath = path.join(volumesPath, volumeId);

  try {
    await fs.access(volumePath);

    const files = await recursiveSearch(volumePath, query, volumePath);

    res.json({ files });
  } catch (err) {
    if (err.code === "ENOENT") {
      res.status(404).json({ message: "Volume not found" });
    } else {
      res.status(500).json({ message: err.message });
    }
  }
});

module.exports = router;
