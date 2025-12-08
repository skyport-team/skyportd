const express = require("express");
const router = express.Router();
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const multer = require("multer");
const upload = multer({ dest: "tmp/" });
const { safePath } = require("../utils/SafePath");
const { calculateDirectorySize } = require("../utils/FileType");

/**
 * Reads the disk limit for a volume from states.json
 */
async function getDiskLimit(volumeId) {
  const statesFilePath = path.join(__dirname, "../storage/states.json");
  try {
    if (fsSync.existsSync(statesFilePath)) {
      const statesData = JSON.parse(await fs.readFile(statesFilePath, "utf8"));
      if (statesData[volumeId] && statesData[volumeId].diskLimit) {
        return statesData[volumeId].diskLimit;
      }
    }
  } catch (err) {
    console.warn("Failed to read disk limit:", err.message);
  }
  return 0; // 0 = unlimited
}

/**
 * POST /:id/files/upload
 * Uploads one or more files to a specified volume, optionally within a subdirectory.
 *
 * @param {string} id - The volume identifier.
 * @param {string} [path] - Optional. A subdirectory within the volume where files should be stored.
 */
router.post("/fs/:id/files/upload", upload.array("files"), async (req, res) => {
  const { id } = req.params;
  const volumePath = path.join(__dirname, "../volumes", id);
  const subPath = req.query.path || "";

  try {
    // Check disk limit before processing upload
    const diskLimit = await getDiskLimit(id);
    if (diskLimit > 0) {
      const currentSize = await calculateDirectorySize(volumePath);
      const currentSizeMiB = currentSize / (1024 * 1024);
      const uploadSize = req.files.reduce((sum, file) => sum + file.size, 0);
      const uploadSizeMiB = uploadSize / (1024 * 1024);
      
      if (currentSizeMiB + uploadSizeMiB > diskLimit) {
        // Clean up temporary files
        await Promise.all(req.files.map(file => fs.unlink(file.path).catch(() => {})));
        return res.status(413).json({ 
          message: "Storage limit exceeded. Please delete some files or increase your disk limit.",
          currentUsageMiB: Math.round(currentSizeMiB),
          limitMiB: diskLimit,
          uploadSizeMiB: Math.round(uploadSizeMiB)
        });
      }
    }

    const filePath = safePath(volumePath, subPath);

    await Promise.all(
      req.files.map((file) => {
        const destPath = path.join(filePath, file.originalname);
        return fs.rename(file.path, destPath);
      })
    );

    res.json({ message: "Files uploaded successfully" });
  } catch (err) {
    req.files.forEach((file) => fs.unlink(file.path)); // Cleanup any saved files in case of failure
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

