const mysql = require("mysql2/promise");
const config = require("../config.json");
const logger = require("cat-loggr");
const crypto = require("crypto");

const log = new logger();

/**
 * Generates a random password for the new MySQL user.
 * @returns {string} - The generated password.
 */
function generatePassword() {
  return crypto.randomBytes(16).toString("base64");
}

/**
 * Creates a new MySQL database and user.
 * @param {string} dbName - The name of the database to be created.
 * @returns {Promise<object>} - The database and user credentials.
 */
async function createDatabaseAndUser(dbName) {
  let connection;
  const userName = `user_${dbName}`;
  const password = generatePassword();
  const credentials = { dbName, userName, password, host: config.mysql.host };

  if (!config.mysql || !config.mysql.host || !config.mysql.user) {
    log.error("Invalid MySQL configuration:", config.mysql);
    throw new Error("MySQL configuration is incomplete");
  }

  try {
    connection = await mysql.createConnection({
      host: config.mysql.host,
      user: config.mysql.user,
      password: config.mysql.password || "",
    });

    log.info("Connected to the MySQL server.");

    const createDbQuery = `CREATE DATABASE \`${dbName}\``;
    const createUserQuery = `CREATE USER '${userName}'@'%' IDENTIFIED BY '${password}'`;
    const grantPrivilegesQuery = `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${userName}'@'%' WITH GRANT OPTION`;

    await connection.query(createDbQuery);
    log.info("Database created:", dbName);

    await connection.query(createUserQuery);
    log.info("User created:", userName);

    await connection.query(grantPrivilegesQuery);
    log.info("Privileges granted to user:", userName);

    log.info("Credentials:", credentials);

    return credentials;
  } catch (err) {
    if (err.code === "ECONNREFUSED") {
      log.error(
        `MySQL Connection Failed: Can't reach MySQL server at ${config.mysql.host}`
      );
      throw new Error("MySQL server is not running or unreachable");
    }

    log.error("MySQL Connection Error:", {
      message: err.message,
      code: err.code,
    });
    throw err;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

module.exports = {
  createDatabaseAndUser,
};
