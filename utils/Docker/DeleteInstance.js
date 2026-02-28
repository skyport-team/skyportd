const Docker = require("../Docker");
const fs = require("fs");
const path = require("path");
const docker = new Docker({ socketPath: process.env.dockerSocket });

/**
 * GET /:id/delete
 * Deletes a specific Docker container and its associated volume.
 *
 * @param {Object} req - The HTTP request object, containing the container ID as a URL parameter.
 * @param {Object} res - The HTTP response object used to return the result of the delete operation.
 * @returns {Response} JSON response indicating success or failure of the delete operation.
 */
const deleteInstance = async (req, res) => {
  if (!req.params.id)
    return res.status(400).json({ message: "Container ID is required" });
  const container = docker.getContainer(req.params.id);

  try {
    const info = await container.inspect();
    const Name = info.Name;
    const nameWithoutSlash = Name.slice(0, 1) === "/" ? Name.slice(1) : Name;
    const volumeDir = path.join(__dirname, "../../volumes", nameWithoutSlash);

    await container.remove({ force: true });
    fs.rmSync(volumeDir, { force: true, recursive: true });

    res.json({
      message: "Container and associated volume deleted successfully",
    });
  } catch (err) {
    // Container already gone (404) — still clean up volume and return success
    if (err.message && err.message.includes("404")) {
      const volumeDir = path.join(__dirname, "../../volumes", req.params.id);
      fs.rmSync(volumeDir, { force: true, recursive: true });
      return res.json({
        message: "Container already removed, cleaned up resources",
      });
    }
    res.status(500).json({ message: err.message });
  }
};

module.exports = deleteInstance;
