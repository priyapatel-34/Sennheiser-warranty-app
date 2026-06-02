import dotenv from 'dotenv';
import mysql from "mysql2/promise";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 👇 this points to project root .env (NOT /web)
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
}

console.log("CWD:", process.cwd());
console.log("ENV:", {
  MYSQL_HOST: process.env.MYSQL_HOST,
  MYSQL_USER: process.env.MYSQL_USER,
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ? "****" : "EMPTY",
  MYSQL_DATABASE: process.env.MYSQL_DATABASE,
  MYSQL_PORT: process.env.MYSQL_PORT
});



export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: process.env.MYSQL_PORT,
  connectionLimit: 10,
  ssl: {
    rejectUnauthorized: false
  },
  charset: "utf8mb4"
});



// export const pool = mysql.createPool({
//   host: 'localhost',
//   user: 'root',
//   password: 'root',
//   database: 'warranty-live-app',
//   port: 3307,
//   waitForConnections: true,
//   connectionLimit: 10
// });