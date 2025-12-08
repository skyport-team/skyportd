/**
 * @fileoverview Handles container power management actions via Docker. This module defines routes
 * to start, stop, restart, pause, unpause, and kill Docker containers identified by their ID.
 * Each action is accessed through a POST request specifying the action as part of the URL. Utilizes
 * Dockerode to interface with the Docker API for performing these operations on specific containers.
 */

const express = require("express");
const router = express.Router();
const Docker = require("dockerode");
const fs = require("fs");
const path = require("path");
const { calculateDirectorySize } = require("../utils/FileType");

const docker = new Docker({ socketPath: process.env.dockerSocket });

/**
 * Reads the disk limit and volume ID association from states.json
 */
function getStateForContainer(containerId) {
  const statesFilePath = path.join(__dirname, "../storage/states.json");
  try {
    if (fs.existsSync(statesFilePath)) {
      const statesData = JSON.parse(fs.readFileSync(statesFilePath, "utf8"));
      // Find the state entry that has this containerId
      for (const [volumeId, state] of Object.entries(statesData)) {
        if (state.containerId === containerId) {
          return { volumeId, ...state };
        }
      }
    }
  } catch (err) {
    console.warn("Failed to read states:", err.message);
  }
  return null;
}

/**
 * POST /:id/:power
 * Manages the power state of a Docker container based on the action specified in the URL. Supports actions
 * like start, stop, restart, pause, unpause, and kill. Each action is directly invoked on the container
 * object from Dockerode based on the specified container ID and action parameter. Responses include
 * success messages or error handling for invalid actions or execution failures.
 *
 * @param {Object} req - The HTTP request object, containing the container ID and the power action as URL parameters.
 * @param {Object} res - The HTTP response object used to return success or error messages.
 * @returns {Response} JSON response indicating the outcome of the action, either successful execution or an error.
 */
router.post("/instances/:id/:power", async (req, res) => {
  const { power } = req.params;
  const containerId = req.params.id;
  const container = docker.getContainer(containerId);
  
  try {
    // Check storage limit before starting
    if (power === "start" || power === "restart") {
      const state = getStateForContainer(containerId);
      if (state && state.diskLimit && state.diskLimit > 0) {
        const volumePath = path.join(__dirname, "../volumes", state.volumeId);
        try {
          const currentSize = await calculateDirectorySize(volumePath);
          const currentSizeMiB = currentSize / (1024 * 1024);
          
          if (currentSizeMiB >= state.diskLimit) {
            return res.status(403).json({ 
              message: "Cannot start server: storage limit exceeded. Please delete some files or increase your disk limit.",
              currentUsageMiB: Math.round(currentSizeMiB),
              limitMiB: state.diskLimit
            });
          }
        } catch (sizeErr) {
          // If we can't calculate size, allow start anyway
          console.warn("Could not calculate volume size:", sizeErr.message);
        }
      }
    }

    switch (power) {
      case "start":
      case "stop":
      case "restart":
      case "pause":
      case "unpause":
      case "kill":
        await container[power]();
        res.status(200).json({ message: `Container ${power}ed successfully` });
        break;
      default:
        res.status(400).json({ message: "Invalid power action" });
    }
  } catch (err) {
    if (err.statusCode === 304) {
      res.status(304).json({ message: err.message });
    } else {
      res.status(500).json({ message: err.message });
    }
  }
});

module.exports = router;

