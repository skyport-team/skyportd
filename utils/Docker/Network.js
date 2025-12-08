const Docker = require("../Docker");
const docker = new Docker({ socketPath: process.env.dockerSocket });

/**
 * GET /:id/ports
 * List all ports for a specific Docker container
 *
 * @param {Object} req - The HTTP request object, containing the container ID as a URL parameter.
 * @param {Object} res - The HTTP response object used to return the ports list or an error message.
 * @returns {Response} JSON response containing an array of all ports or an error message.
 */
const listInstancePorts = async (req, res) => {
  if (!req.params.id)
    return res.status(400).json({ message: "Container ID is required" });
  
  try {
    const container = docker.getContainer(req.params.id);
    const data = await container.inspect();
    const ports = data.NetworkSettings.Ports || {};
    const portList = Object.keys(ports).map((key) => ({ port: key }));
    res.json(portList);
  } catch (err) {
    res.status(404).json({ message: "Container not found" });
  }
};

module.exports = listInstancePorts;
