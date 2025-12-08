const express = require("express");
const router = express.Router();
const Docker = require("dockerode");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const CatLoggr = require("cat-loggr");
const log = new CatLoggr();
const https = require("https");
const { pipeline } = require("stream/promises");

const docker = new Docker({ socketPath: process.env.dockerSocket });

/* utils */
const statesFilePath = path.join(__dirname, "../storage/states.json");

// Utility function to read states
const readStates = async () => {
  try {
    if (!fsSync.existsSync(statesFilePath)) {
      await fs.writeFile(statesFilePath, JSON.stringify({}, null, 2));
    }
    const data = await fs.readFile(statesFilePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
};

// Utility function to write states
const writeStates = async (states) => {
  if (!fsSync.existsSync(statesFilePath)) {
    await fs.writeFile(statesFilePath, JSON.stringify({}, null, 2));
  }
  await fs.writeFile(statesFilePath, JSON.stringify(states, null, 2));
};

// Utility function to update state
const updateState = async (volumeId, state, containerId = null, diskLimit = null) => {
  const states = await readStates();
  states[volumeId] = { state, containerId, diskLimit };
  await writeStates(states);
};

const downloadFile = async (url, dir, filename) => {
  const filePath = path.join(dir, filename);
  const writeStream = fsSync.createWriteStream(filePath);

  const maxAttempts = 3;
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      attempt++;
      const response = await new Promise((resolve, reject) => {
        https
          .get(url, (res) => {
            resolve(res);
          })
          .on("error", reject);
      });

      if (response.statusCode === 522) {
        log.info(
          `Received status code 522. Waiting for 60 seconds before retrying...`
        );
        await new Promise((resolve) => setTimeout(resolve, 60000));
        continue;
      }

      if (response.statusCode !== 200) {
        throw new Error(
          `Failed to download ${filename}: HTTP status code ${response.statusCode} on the URL ${url}`
        );
      }

      await pipeline(response, writeStream);
      log.info(`Downloaded ${filename} successfully.`);
      break;
    } catch (err) {
      log.error(`Attempt ${attempt} failed: ${err.message}`);
      await fsSync.promises.unlink(filePath).catch(() => {});
      if (attempt === maxAttempts) {
        throw new Error(
          `Failed to download ${filename} after ${maxAttempts} attempts.`
        );
      }
    }
  }
};

const downloadInstallScripts = async (installScripts, dir, variables) => {
  const parsedVariables =
    typeof variables === "string" ? JSON.parse(variables) : variables;

  for (const script of installScripts) {
    try {
      let updatedUri = script.Uri;
      for (const [key, value] of Object.entries(parsedVariables)) {
        const regex = new RegExp(`{{${key}}}`, "g");
        updatedUri = updatedUri.replace(regex, value);
        log.info(updatedUri);
      }
      await downloadFile(updatedUri, dir, script.Path);
      log.info(`Successfully downloaded ${script.Path}`);
    } catch (err) {
      log.error(`Failed to download ${script.Path}: ${err.message}`);
    }
  }
};

const replaceVariables = async (dir, variables) => {
  const files = await fs.readdir(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stats = await fs.stat(filePath);
    if (stats.isFile() && !file.endsWith(".jar")) {
      let content = await fs.readFile(filePath, "utf8");
      for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`{{${key}}}`, "g");
        content = content.replace(regex, value);
      }
      await fs.writeFile(filePath, content, "utf8");
      log.info(`Variables replaced in ${file}`);
    }
  }
};

const objectToEnv = (obj) =>
  Object.entries(obj).map(([key, value]) => `${key}=${value}`);

const createContainerOptions = (config, volumePath) => ({
  name: config.Id,
  Image: config.Image,
  ExposedPorts: config.Ports,
  AttachStdout: true,
  AttachStderr: true,
  AttachStdin: true,
  Tty: true,
  OpenStdin: true,
  HostConfig: {
    PortBindings: config.PortBindings,
    Binds: [`${volumePath}:/app/data`],
    Memory: config.Memory * 1024 * 1024,
    CpuCount: config.Cpu,
    // On Windows, 'host' network mode doesn't work the same way as on Linux
    // Using 'bridge' mode instead ensures proper port forwarding on Windows
    NetworkMode: process.platform === "win32" ? "bridge" : "host",
  },
  Env: config.Env,
  ...(config.Cmd && { Cmd: config.Cmd }),
});

const createContainer = async (req, res) => {
  log.info("Deployment in progress...");
  let { Image, Id, Cmd, Env, Ports, Scripts, Memory, Cpu, Disk, PortBindings } =
    req.body;
  let variables = req.body.variables || {};

  // Early port validation to reject invalid specs and avoid stuck "INSTALLING" state i think
  if (PortBindings) {
    for (const [containerPort, hostBindings] of Object.entries(PortBindings)) {
      for (const binding of hostBindings) {
        const port = parseInt(binding.HostPort, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          log.error(`Invalid port specification: ${binding.HostPort}`);
          return res.status(400).json({
            message: `Invalid port specification: ${binding.HostPort}. Port must be between 1 and 65535.`,
          });
        }
      }
    }
  }

  if (typeof variables !== "string") {
    variables = JSON.stringify(variables);
  } else {
    try {
      JSON.parse(variables);
    } catch (e) {
      variables = JSON.stringify(variables);
    }
  }

  try {
    const volumePath = path.join(__dirname, "../volumes", Id);
    await fs.mkdir(volumePath, { recursive: true });
    const primaryPort = Object.values(PortBindings)[0][0].HostPort;

    const variablesEnv =
      variables && Object.keys(variables).length > 0
        ? objectToEnv(JSON.parse(variables))
        : [];

    const environmentVariables = [
      ...(Env || []),
      ...variablesEnv,
      `PRIMARY_PORT=${primaryPort}`,
    ];

    // Update state to INSTALLING
    await updateState(Id, "INSTALLING", null, Disk || 0);

    log.info(`Pulling image: ${Image}`);
    try {
      const stream = await docker.pull(Image);
      await new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (err, result) => {
          if (err) {
            return reject(new Error(`Failed to pull image: ${err.message}`));
          }
          log.info(`Image ${Image} pulled successfully.`);
          resolve(result);
        });
      });
    } catch (err) {
      log.error(`Error pulling image ${Image}:`, err);
      return res.status(500).json({ message: err.message });
    }

    // Respond immediately with volumeId
    res.status(202).json({
      message: "Deployment started",
      Env: environmentVariables,
      volumeId: Id,
    });

    const containerOptions = createContainerOptions(
      {
        Image,
        Id,
        Cmd,
        Ports,
        Memory,
        Cpu,
        PortBindings,
        Env: environmentVariables,
      },
      volumePath
    );

    const container = await docker.createContainer(containerOptions);
    log.info("Container created: " + container.id);

    if (Scripts && Scripts.Install && Array.isArray(Scripts.Install)) {
      const dir = path.join(__dirname, "../volumes", Id);
      await downloadInstallScripts(Scripts.Install, dir, variables || {});

      const replaceVars = {
        primaryPort: primaryPort,
        containerName: container.id.substring(0, 12),
        timestamp: new Date().toISOString(),
        randomString: Math.random().toString(36).substring(7),
      };

      await replaceVariables(dir, replaceVars);
    }

    await container.start();

    // Update state to READY
    await updateState(Id, "READY", container.id, Disk || 0);

    log.info("Deployment completed successfully");
  } catch (err) {
    log.error("Deployment failed: " + err.message);
    await updateState(Id, "FAILED", null, Disk || 0);
  }
};

const deleteContainer = async (req, res) => {
  const containerId = req.params.id;
  const container = docker.getContainer(containerId);
  try {
    const containerInfo = await container.inspect();
    if (!containerInfo.Name) {
      return res.status(400).json({
        message: "Container does not have the required names",
        containerId: containerId,
      });
    }

    const volumeId = containerInfo.Name.replace(/^\//, "");
    if (!volumeId) {
      return res.status(400).json({
        message: "No volumeId found in container",
        containerId: containerId,
      });
    }
    const volumePath = path.join(__dirname, "../volumes", volumeId);

    const volumeExists = await fs
      .access(volumePath)
      .then(() => true)
      .catch(() => false);

    if (containerInfo.State.Running) {
      log.info(`Stopping container ${containerInfo.Id.substring(0, 12)}`);
      await container.stop({ t: 10 });
    }

    await container.remove();

    if (volumeExists) {
      await fs.rm(volumePath, { recursive: true, force: true });
    }

    const states = await readStates();
    delete states[volumeId];
    await writeStates(states);

    res.status(200).json({
      message: "Container and volume removed successfully",
      containerId: containerId,
      volumeId: volumeId,
    });
  } catch (err) {
    console.error("Delete container error:", err);
    res.status(500).json({
      message: err.message,
    });
  }
};

const redeployContainer = async (req, res) => {
  const { id } = req.params;
  const container = docker.getContainer(id);
  try {
    const { Idd } = req.params;
    const { Disk } = req.body;
    await updateState(Idd, "INSTALLING", null, Disk || 0);
    const containerInfo = await container.inspect();
    if (containerInfo.State.Running) {
      log.info(`Stopping container ${id}`);
      await container.stop();
    }
    log.info(`Removing container ${id}`);
    await container.remove();

    const { Image, Id, Ports, Memory, Cpu, PortBindings, Env } = req.body;
    const volumePath = path.join(__dirname, "../volumes", Id);
    log.info(`Pulling image: ${Image}`);
    try {
      const stream = await docker.pull(Image);
      await new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (err, result) => {
          if (err) {
            return reject(new Error(`Failed to pull image: ${err.message}`));
          }
          log.info(`Image ${Image} pulled successfully.`);
          resolve(result);
        });
      });
    } catch (err) {
      log.error(`Error pulling image ${Image}:`, err);
      return res.status(500).json({ message: err.message });
    }

    const containerOptions = createContainerOptions(
      {
        Image,
        Id,
        Ports,
        Memory,
        Cpu,
        PortBindings,
        Env,
      },
      volumePath
    );

    const newContainer = await docker.createContainer(containerOptions);
    await newContainer.start();
    res.status(200).json({
      message: "Container redeployed successfully",
      containerId: newContainer.id,
    });
    await updateState(Idd, "READY", newContainer.id, Disk || 0);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const reinstallContainer = async (req, res) => {
  const { id } = req.params;
  const container = docker.getContainer(id);

  try {
    const { Idd } = req.params;
    await updateState(Idd, "INSTALLING");
    const containerInfo = await container.inspect();
    if (containerInfo.State.Running) {
      log.info(`Stopping container ${id}`);
      await container.stop();
    }
    log.info(`Removing container ${id}`);
    await container.remove();

    const env2json = (env) =>
      env.reduce((obj, item) => {
        const [key, value] = item.split("=");
        obj[key] = value;
        return obj;
      }, {});

    const { Image, Id, Ports, Memory, Cpu, PortBindings, Env, imageData } =
      req.body;
    const volumePath = path.join(__dirname, "../volumes", Id);

    log.info(`Pulling image: ${Image}`);
    try {
      const stream = await docker.pull(Image);
      await new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (err, result) => {
          if (err) {
            return reject(new Error(`Failed to pull image: ${err.message}`));
          }
          log.info(`Image ${Image} pulled successfully.`);
          resolve(result);
        });
      });
    } catch (err) {
      log.error(`Error pulling image ${Image}:`, err);
      return res.status(500).json({ message: err.message });
    }

    const containerOptions = createContainerOptions(
      {
        Image,
        Id,
        Ports,
        Memory,
        Cpu,
        PortBindings,
        Env,
      },
      volumePath
    );

    const newContainer = await docker.createContainer(containerOptions);
    if (
      imageData &&
      imageData.Scripts &&
      imageData.Scripts.Install &&
      Array.isArray(imageData.Scripts.Install)
    ) {
      const dir = path.join(__dirname, "../volumes", Id);

      await downloadInstallScripts(
        imageData.Scripts.Install,
        dir,
        env2json(Env)
      );

      const variables = {
        primaryPort: Object.values(PortBindings)[0][0].HostPort,
        containerName: newContainer.id.substring(0, 12),
        timestamp: new Date().toISOString(),
        randomString: Math.random().toString(36).substring(7),
      };
      await replaceVariables(dir, variables);
    }

    await newContainer.start();
    res.status(200).json({
      message: "Container reinstalled successfully",
      containerId: newContainer.id,
    });
    await updateState(Idd, "READY", newContainer.id);
  } catch (err) {
    log.error("Error reinstalling instance:", err);
    res.status(500).json({ message: err.message });
  }
};

const editContainer = async (req, res) => {
  const { id } = req.params;
  const { Image, Memory, Cpu, VolumeId } = req.body;

  try {
    log.info(`Editing container: ${id}`);
    const container = docker.getContainer(id);
    const containerInfo = await container.inspect();
    const existingConfig = containerInfo.Config;
    const existingHostConfig = containerInfo.HostConfig;

    const newContainerOptions = createContainerOptions(
      {
        Image: Image || existingConfig.Image,
        Id: id,
        Ports: existingConfig.ExposedPorts,
        Memory: Memory || existingHostConfig.Memory / (1024 * 1024),
        Cpu: Cpu || existingHostConfig.CpuCount,
        PortBindings: existingHostConfig.PortBindings,
        Env: existingConfig.Env,
        Cmd: existingConfig.Cmd,
      },
      path.join(__dirname, "../volumes", VolumeId)
    );

    log.info(`Stopping container: ${id}`);
    await container.stop();
    log.info(`Removing container: ${id}`);
    await container.remove();
    log.info("Creating new container with updated configuration");
    const newContainer = await docker.createContainer(newContainerOptions);
    await newContainer.start();

    log.info(`Edit completed! New container ID: ${newContainer.id}`);
    res.status(200).json({
      message: "Container edited successfully",
      oldContainerId: id,
      newContainerId: newContainer.id,
    });
  } catch (err) {
    log.error(`Edit failed: ${err.message}`);
    res.status(500).json({ message: err.message });
  }
};

const getContainerState = async (req, res) => {
  const { volumeId } = req.params;
  try {
    const states = await readStates();
    const containerState = states[volumeId] || { state: "UNKNOWN" };
    log.info(JSON.stringify(containerState));
    res.status(200).json(containerState);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Routes
router.post("/instances/create", createContainer);
router.delete("/instances/:id", deleteContainer);
router.post("/instances/redeploy/:id/:Idd", redeployContainer);
router.post("/instances/reinstall/:id/:Idd", reinstallContainer);
router.put("/instances/edit/:id", editContainer);
router.get("/state/:volumeId", getContainerState);

module.exports = router;
