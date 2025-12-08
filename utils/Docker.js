const http = require("node:http");
const { EventEmitter } = require("node:events");

class Docker {
  constructor(options = {}) {
    this.socketPath = options.socketPath || process.env.dockerSocket;
    this.apiVersion = null; // Will be auto-detected
  }

  /**
   * Auto-detect Docker API version from daemon
   */
  async _getApiVersion() {
    if (this.apiVersion) return this.apiVersion;
    
    try {
      const version = await this._rawRequest("GET", "/version");
      this.apiVersion = version.ApiVersion;
      return this.apiVersion;
    } catch (err) {
      // Fallback to a safe default
      this.apiVersion = "1.44";
      return this.apiVersion;
    }
  }

  /**
   * Raw HTTP request without version prefix (for version detection)
   */
  _rawRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        socketPath: this.socketPath,
        path: path,
        method: method,
        headers: { "Content-Type": "application/json" },
      };

      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data ? JSON.parse(data) : null);
            } else {
              reject(new Error(`Docker API Error: ${res.statusCode} - ${data}`));
            }
          } catch (error) {
            reject(new Error(`Parsing error: ${error.message}`));
          }
        });
      });

      req.on("error", (error) => reject(error));
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  /**
   * Main HTTP request with auto API version
   */
  async _request(method, path, body = null, expectJson = true) {
    const version = await this._getApiVersion();
    
    return new Promise((resolve, reject) => {
      const options = {
        socketPath: this.socketPath,
        path: `/v${version}${path}`,
        method: method,
        headers: { "Content-Type": "application/json" },
      };

      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              if (expectJson && data) {
                resolve(JSON.parse(data));
              } else {
                resolve(data || null);
              }
            } else {
              let errorMessage = data;
              if (expectJson && data) {
                try {
                  const parsed = JSON.parse(data);
                  errorMessage = parsed.message || data;
                } catch {}
              }
              reject(new Error(`Docker API Error: ${res.statusCode} - ${errorMessage}`));
            }
          } catch (error) {
            reject(new Error(`Parsing error: ${error.message}`));
          }
        });
      });

      req.on("error", (error) => reject(error));
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  /**
   * Streaming request for logs, stats, etc.
   */
  async _streamRequest(method, path, onData, onEnd, body = null) {
    const version = await this._getApiVersion();
    
    return new Promise((resolve, reject) => {
      const options = {
        socketPath: this.socketPath,
        path: `/v${version}${path}`,
        method: method,
        headers: { "Content-Type": "application/json" },
      };

      const req = http.request(options, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          res.on("data", (chunk) => onData && onData(chunk));
          res.on("end", () => {
            onEnd && onEnd();
            resolve();
          });
          resolve(res); // Return the stream
        } else {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            reject(new Error(`Docker API Error: ${res.statusCode} - ${data}`));
          });
        }
      });

      req.on("error", (error) => reject(error));
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  // ==================== Basic Methods ====================

  async ping() {
    return this._request("GET", "/_ping", null, false);
  }

  async info() {
    return this._request("GET", "/info");
  }

  async version() {
    return this._request("GET", "/version");
  }

  // ==================== Container Methods ====================

  async listContainers(options = {}) {
    const params = new URLSearchParams();
    if (options.all) params.append("all", "1");
    if (options.limit) params.append("limit", options.limit);
    if (options.filters) params.append("filters", JSON.stringify(options.filters));
    return this._request("GET", `/containers/json?${params.toString()}`);
  }

  /**
   * Get a container object
   */
  getContainer(containerId) {
    return new Container(this, containerId);
  }

  async createContainer(config) {
    const name = config.name;
    delete config.name;
    const query = name ? `?name=${encodeURIComponent(name)}` : "";
    return this._request("POST", `/containers/create${query}`, config);
  }

  // ==================== Image Methods ====================

  async listImages(options = {}) {
    const params = new URLSearchParams();
    if (options.all) params.append("all", "1");
    return this._request("GET", `/images/json?${params.toString()}`);
  }

  /**
   * Pull an image from registry (returns a stream for progress)
   */
  async pull(imageName, onProgress) {
    const version = await this._getApiVersion();
    
    return new Promise((resolve, reject) => {
      const options = {
        socketPath: this.socketPath,
        path: `/v${version}/images/create?fromImage=${encodeURIComponent(imageName)}`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      };

      const req = http.request(options, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          let lastStatus = null;
          
          res.on("data", (chunk) => {
            const lines = chunk.toString().split("\n").filter(l => l.trim());
            for (const line of lines) {
              try {
                const data = JSON.parse(line);
                lastStatus = data;
                if (onProgress) onProgress(data);
              } catch {}
            }
          });
          
          res.on("end", () => {
            if (lastStatus && lastStatus.error) {
              reject(new Error(lastStatus.error));
            } else {
              resolve(lastStatus);
            }
          });
        } else {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            reject(new Error(`Failed to pull image: ${res.statusCode} - ${data}`));
          });
        }
      });

      req.on("error", (error) => reject(error));
      req.end();
    });
  }

  /**
   * Modem.followProgress
   */
  get modem() {
    const self = this;
    return {
      followProgress(stream, onFinished, onProgress) {
        let allOutput = [];
        
        stream.on("data", (chunk) => {
          const lines = chunk.toString().split("\n").filter(l => l.trim());
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              allOutput.push(data);
              if (onProgress) onProgress(data);
            } catch {}
          }
        });
        
        stream.on("end", () => {
          const lastStatus = allOutput[allOutput.length - 1];
          if (lastStatus && lastStatus.error) {
            onFinished(new Error(lastStatus.error), allOutput);
          } else {
            onFinished(null, allOutput);
          }
        });
        
        stream.on("error", (err) => {
          onFinished(err, allOutput);
        });
      }
    };
  }

  // ==================== Network Methods ====================

  async listNetworks() {
    return this._request("GET", "/networks");
  }

  async createNetwork(config) {
    return this._request("POST", "/networks/create", config);
  }

  async removeNetwork(networkId) {
    return this._request("DELETE", `/networks/${networkId}`, null, false);
  }
}

/**
 * Container class
 */
class Container {
  constructor(docker, id) {
    this.docker = docker;
    this.id = id;
  }

  inspect(callback) {
    const promise = this.docker._request("GET", `/containers/${this.id}/json`);
    if (typeof callback === "function") {
      promise.then(data => callback(null, data)).catch(err => callback(err));
    } else {
      return promise;
    }
  }

  async start() {
    return this.docker._request("POST", `/containers/${this.id}/start`, null, false);
  }

  async stop(options = {}) {
    const params = new URLSearchParams();
    if (options.t) params.append("t", options.t);
    return this.docker._request("POST", `/containers/${this.id}/stop?${params.toString()}`, null, false);
  }

  async restart(options = {}) {
    const params = new URLSearchParams();
    if (options.t) params.append("t", options.t);
    return this.docker._request("POST", `/containers/${this.id}/restart?${params.toString()}`, null, false);
  }

  async kill(options = {}) {
    const params = new URLSearchParams();
    if (options.signal) params.append("signal", options.signal);
    return this.docker._request("POST", `/containers/${this.id}/kill?${params.toString()}`, null, false);
  }

  async pause() {
    return this.docker._request("POST", `/containers/${this.id}/pause`, null, false);
  }

  async unpause() {
    return this.docker._request("POST", `/containers/${this.id}/unpause`, null, false);
  }

  async remove(options = {}) {
    const params = new URLSearchParams();
    if (options.force) params.append("force", "1");
    if (options.v) params.append("v", "1");
    return this.docker._request("DELETE", `/containers/${this.id}?${params.toString()}`, null, false);
  }

  /**
   * Get container stats (callback style)
   */
  stats(options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    
    const stream = options.stream !== false;
    const path = `/containers/${this.id}/stats?stream=${stream ? 1 : 0}`;
    
    if (!stream) {
      // One-shot stats
      this.docker._request("GET", path)
        .then(stats => callback(null, stats))
        .catch(err => callback(err));
    } else {
      // Streaming stats - return a mock stream
      this.docker._streamRequest("GET", path, null, null)
        .then(res => callback(null, res))
        .catch(err => callback(err));
    }
  }

  /**
   * Get container logs (returns stream)
   */
  async logs(options = {}) {
    const params = new URLSearchParams({
      stdout: options.stdout ? "1" : "0",
      stderr: options.stderr ? "1" : "0",
      follow: options.follow ? "1" : "0",
      tail: options.tail !== undefined ? options.tail.toString() : "all",
    });
    
    const version = await this.docker._getApiVersion();
    
    return new Promise((resolve, reject) => {
      const reqOptions = {
        socketPath: this.docker.socketPath,
        path: `/v${version}/containers/${this.id}/logs?${params.toString()}`,
        method: "GET",
      };

      const req = http.request(reqOptions, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res); // Return the stream
        } else {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => reject(new Error(`Failed to get logs: ${res.statusCode} - ${data}`)));
        }
      });

      req.on("error", reject);
      req.end();
    });
  }

  /**
   * Create exec instance
   */
  async exec(options) {
    const execConfig = {
      AttachStdin: options.AttachStdin || false,
      AttachStdout: options.AttachStdout || true,
      AttachStderr: options.AttachStderr || true,
      Tty: options.Tty || false,
      Cmd: options.Cmd,
    };

    const exec = await this.docker._request("POST", `/containers/${this.id}/exec`, execConfig);
    return new Exec(this.docker, exec.Id);
  }

  /**
   * Attach to container (for terminal)
   */
  async attach(options = {}) {
    const params = new URLSearchParams({
      stream: options.stream ? "1" : "0",
      stdin: options.stdin ? "1" : "0",
      stdout: options.stdout ? "1" : "0",
      stderr: options.stderr ? "1" : "0",
    });
    
    const version = await this.docker._getApiVersion();
    
    return new Promise((resolve, reject) => {
      const reqOptions = {
        socketPath: this.docker.socketPath,
        path: `/v${version}/containers/${this.id}/attach?${params.toString()}`,
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.docker.raw-stream",
          "Connection": "Upgrade",
          "Upgrade": "tcp",
        },
      };

      const req = http.request(reqOptions, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res);
        } else {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => reject(new Error(`Failed to attach: ${res.statusCode} - ${data}`)));
        }
      });

      req.on("upgrade", (res, socket, head) => {
        // Create a duplex stream wrapper
        const stream = socket;
        stream.write = socket.write.bind(socket);
        stream.end = socket.end.bind(socket);
        resolve(stream);
      });

      req.on("error", reject);
      req.end();
    });
  }
}

/**
 * Exec class for running commands in containers
 */
class Exec {
  constructor(docker, id) {
    this.docker = docker;
    this.id = id;
  }

  async start(options = {}) {
    const startConfig = {
      Detach: options.Detach || false,
      Tty: options.Tty || false,
    };

    const version = await this.docker._getApiVersion();
    
    return new Promise((resolve, reject) => {
      const reqOptions = {
        socketPath: this.docker.socketPath,
        path: `/v${version}/exec/${this.id}/start`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      };

      const req = http.request(reqOptions, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res); // Return stream for output
        } else {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => reject(new Error(`Exec start failed: ${res.statusCode} - ${data}`)));
        }
      });

      req.on("error", reject);
      req.write(JSON.stringify(startConfig));
      req.end();
    });
  }

  async inspect() {
    return this.docker._request("GET", `/exec/${this.id}/json`);
  }
}

module.exports = Docker;
