const Docker = require("../Docker");
const docker = new Docker({ socketPath: process.env.dockerSocket });

/**
 * GET /:id
 * Fetches detailed information about a specific Docker container identified by the ID provided in the URL parameter.
 *
 * @param {Object} req - The HTTP request object, containing the container ID as a URL parameter.
 * @param {Object} res - The HTTP response object used to return detailed container data or an error message.
 * @returns {Response} JSON response with detailed container information or an error message indicating the container was not found.
 */
const getInstanceDetails = async (req, res) => {
  if (!req.params.id)
    return res.status(400).json({ message: "Container ID is required" });
  
  try {
    const container = docker.getContainer(req.params.id);
    const data = await container.inspect();
    res.json(data);
  } catch (err) {
    res.status(404).json({ message: "Container not found" });
  }
};

module.exports = getInstanceDetails;
