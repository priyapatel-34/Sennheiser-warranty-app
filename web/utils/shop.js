// Resolves the installed shop id from a shop domain or session.
import { pool } from "../db/mysql.js";

export async function resolveShopId(shopOrSession) {
  const shopDomain =
    typeof shopOrSession === "string" ? shopOrSession : shopOrSession?.shop;
  if (!shopDomain) return null;

  const [[shopRow]] = await pool.query(
    `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
    [shopDomain]
  );
  return shopRow?.id ?? null;
}
