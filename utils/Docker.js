const https = require("node:https");
const http = require("node:http");
const { URL } = require("node:url");

class Docker {
  constructor(options) {
    this.socketPath = options.socketPath;
    this.baseUrl =
      process.platform === "win32"
        ? "http://localhost/v1.41"
        : `http://unix:${this.socketPath}:/v1.41`;
  }

  _request(method, path, body = null, expectJson = true) {
    return new Promise((resolve, reject) => {
      const options = {
        socketPath: this.socketPath,
        path: `/v1.41${path}`,
        method: method,
        headers: {
          "Content-Type": "application/json",
        },
      };

      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              if (expectJson && data) {
                const parsedData = JSON.parse(data);
                resolve(parsedData);
              } else {
                // For non-JSON responses or empty responses
                resolve(data || null);
              }
            } else {
              let errorMessage;
              if (expectJson && data) {
                try {
                  const parsedError = JSON.parse(data);
                  errorMessage = parsedError.message || data;
                } catch {
                  errorMessage = data;
                }
              } else {
                errorMessage = data;
              }
              reject(
                new Error(
                  `Docker API Error: ${res.statusCode} - ${errorMessage}`
                )
              );
            }
          } catch (error) {
            reject(new Error(`Parsing error: ${error.message}`));
          }
        });
      });

      req.on("error", (error) => reject(error));

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  async ping() {
    return this._request("GET", "/_ping", null, false);
  }

  async listContainers(all = false) {
    return this._request("GET", `/containers/json?all=${all ? 1 : 0}`);
  }

  async getContainer(containerId) {
    return this._request("GET", `/containers/${containerId}/json`);
  }

  async createContainer(containerConfig) {
    return this._request("POST", "/containers/create", containerConfig);
  }

  async startContainer(containerId) {
    return this._request(
      "POST",
      `/containers/${containerId}/start`,
      null,
      false
    );
  }

  async stopContainer(containerId) {
    return this._request(
      "POST",
      `/containers/${containerId}/stop`,
      null,
      false
    );
  }

  async restartContainer(containerId) {
    return this._request(
      "POST",
      `/containers/${containerId}/restart`,
      null,
      false
    );
  }

  async removeContainer(containerId, force = false) {
    return this._request(
      "DELETE",
      `/containers/${containerId}?force=${force ? 1 : 0}`,
      null,
      false
    );
  }

  async getContainerLogs(containerId, options = {}) {
    const queryParams = new URLSearchParams({
      stdout: 1,
      stderr: 1,
      tail: options.tail || "all",
      ...options,
    }).toString();

    return this._request(
      "GET",
      `/containers/${containerId}/logs?${queryParams}`,
      null,
      false
    );
  }

  async getContainerStats(containerId) {
    return this._request(
      "GET",
      `/containers/${containerId}/stats?stream=false`
    );
  }

  async getContainerEvents(since = null, until = null) {
    const params = new URLSearchParams();
    if (since) params.append("since", since);
    if (until) params.append("until", until);

    return this._request("GET", `/events?${params.toString()}`);
  }

  async getContainerInspect(containerId) {
    return this._request("GET", `/containers/${containerId}/json`);
  }

  async getContainerExec(containerId) {
    return this._request("GET", `/containers/${containerId}/exec`);
  }

  async getContainerPort(containerId) {
    const container = await this.getContainer(containerId);
    return container.NetworkSettings.Ports;
  }

  async getContainerNetwork(containerId) {
    const container = await this.getContainer(containerId);
    return container.NetworkSettings.Networks;
  }

  async getContainerVolumes(containerId) {
    const container = await this.getContainer(containerId);
    return container.Mounts;
  }

  async handleDockerApiError(method, path, body = null) {
    try {
      return await this._request(method, path, body);
    } catch (error) {
      console.error(`Docker API Error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = Docker;
