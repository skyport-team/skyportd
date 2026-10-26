/**
 * Validates a MySQL database identifier.
 * Enforces alphanumeric characters and underscores, length between 1 and 32 characters.
 *
 * @param {string} dbName - The database identifier to validate.
 * @returns {boolean} True if the identifier is valid.
 */
function isValidDatabaseName(dbName) {
  return typeof dbName === "string" && /^[a-zA-Z0-9_]{1,32}$/.test(dbName);
}

/**
 * Asserts that a database identifier is valid.
 * Throws an Error if invalid.
 *
 * @param {string} dbName - The database identifier to validate.
 * @throws {Error} If the database name does not match /^[a-zA-Z0-9_]{1,32}$/
 */
function validateDatabaseName(dbName) {
  if (!isValidDatabaseName(dbName)) {
    throw new Error("Invalid database name: only alphanumeric characters and underscores allowed.");
  }
}

module.exports = {
  isValidDatabaseName,
  validateDatabaseName,
};
