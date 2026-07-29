import dotenv from 'dotenv';
import mysql from "mysql2/promise";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Points to project root .env (NOT /web)
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
}

export const pool = mysql.createPool({
  host:     process.env.MYSQL_HOST,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port:     process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,

  // Pool sizing
  connectionLimit:  10,
  waitForConnections: true,
  queueLimit:       0,   // unlimited queue — avoids silent drops under burst load

  // Connection timeouts
  // Azure MySQL Flexible Server drops idle connections after ~120 s (wait_timeout).
  // connectTimeout guards against slow SSL handshakes across Azure networking.
  connectTimeout: 20_000,  // 20 s — max time to establish a new connection

  // Keep-alive prevents the MySQL server from silently closing idle pool
  // connections after wait_timeout.  Without this, every request after 2+ min
  // of inactivity forces a full SSL reconnect (+5-15 s on Azure).
  enableKeepAlive:      true,
  keepAliveInitialDelay: 10_000, // send first keepalive after 10 s of idle

  ssl: {
    rejectUnauthorized: false,
  },
  charset: "utf8mb4",
});

// Proactive connection health check at startup.
// Logs a warning (non-fatal) if MySQL is unreachable — useful for Azure cold
// starts where the first pool.query() would be the one to surface the error.
pool.getConnection()
  .then((conn) => {
    console.log("✅ MySQL pool: initial connection succeeded");
    conn.release();
  })
  .catch((err) => {
    console.error("❌ MySQL pool: initial connection failed:", err.message);
  });
