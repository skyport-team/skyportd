const path = require("path");

/**
 * Ensures the target path is within the specified base directory, preventing directory traversal attacks.
 * @param {string} base - The base directory path.
 * @param {string} target - The target directory or file path.
 * @returns {string} The absolute path that is confirmed to be within the base directory.
 * @throws {Error} If the resolved path attempts to escape the base directory.
 */
function safePath(base, target) {
  const resolvedBase = path.resolve(base);
  const fullPath = path.resolve(resolvedBase, target);
  const relative = path.relative(resolvedBase, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Attempting to access outside of the volume");
  }
  return fullPath;
}

module.exports = { safePath };
