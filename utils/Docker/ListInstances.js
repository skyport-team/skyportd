const Docker = require("../Docker");
const docker = new Docker({ socketPath: process.env.dockerSocket });

/**
 * GET /
 * Retrieves a list of all Docker containers on the host, regardless of their state (running, stopped, etc.).
 *
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object used to return the containers list or an error message.
 * @returns {Response} JSON response containing an array of all containers or an error message.
 */
const listInstances = async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    res.json(containers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = listInstances;
