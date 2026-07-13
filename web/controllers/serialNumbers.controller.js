import { pool } from "../db/mysql.js";
import {
  normalizeSerialForLookup,
  validateSerialNumber,
  isSerialNumberImported,
} from "../services/serialVerification.service.js";

async function resolveShopId(session) {
  const [[shopRow]] = await pool.query(
    `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
    [session.shop]
  );
  return shopRow?.id ?? null;
}

/* ---------------------------
   LIST / SEARCH IMPORTED SERIAL NUMBERS (ADMIN)
---------------------------- */
export async function listSerialNumbers(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const searchTerm = normalizeSerialForLookup(req.query.q || req.query.search);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (pageNum - 1) * pageSize;

    const whereClause = `shop_id = ?${searchTerm ? " AND serial_number LIKE ?" : ""}`;
    const params = searchTerm ? [shopId, `%${searchTerm}%`] : [shopId];

    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM imported_serial_numbers WHERE ${whereClause}`,
      params
    );
    const total = countRow?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const [rows] = await pool.query(
      `
      SELECT id, serial_number, imported_at
      FROM imported_serial_numbers
      WHERE ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, pageSize, offset]
    );

    res.json({
      serialNumbers: rows,
      pagination: {
        total,
        totalPages,
        page: pageNum,
        pageSize,
        hasNextPage: pageNum < totalPages,
        hasPreviousPage: pageNum > 1,
      },
    });
  } catch (e) {
    console.error("❌ listSerialNumbers error:", e);
    res.status(500).json({ error: "Failed to load serial numbers" });
  }
}

/* ---------------------------
   IMPORT SERIAL NUMBERS (CSV, PARSED CLIENT-SIDE)
---------------------------- */
export async function importSerialNumbers(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const { serials } = req.body;
    if (!Array.isArray(serials) || serials.length === 0) {
      return res.status(400).json({ error: "No serial numbers provided" });
    }

    let emptyRows = 0;
    let invalidRows = 0;
    let duplicateRows = 0;
    const seen = new Set();
    const candidates = [];

    for (const raw of serials) {
      const validation = validateSerialNumber(raw);

      if (!validation.valid) {
        if (validation.error === "Serial number is required") {
          emptyRows++;
        } else {
          invalidRows++;
        }
        continue;
      }

      const normalized = normalizeSerialForLookup(raw);

      if (seen.has(normalized)) {
        duplicateRows++;
        continue;
      }

      seen.add(normalized);
      candidates.push(normalized);
    }

    if (!candidates.length) {
      return res.status(400).json({
        error: "No valid serial numbers to import",
        imported: 0,
        emptyRows,
        invalidRows,
        duplicateRows,
        totalRows: serials.length,
      });
    }

    const [existingRows] = await pool.query(
      `
      SELECT serial_number
      FROM imported_serial_numbers
      WHERE shop_id = ? AND serial_number IN (?)
      `,
      [shopId, candidates]
    );
    const existingSet = new Set(existingRows.map((r) => r.serial_number));
    const newSerials = candidates.filter((s) => !existingSet.has(s));

    if (newSerials.length) {
      await pool.query(
        `
        INSERT INTO imported_serial_numbers (shop_id, serial_number)
        VALUES ?
        `,
        [newSerials.map((s) => [shopId, s])]
      );
    }

    res.json({
      success: true,
      imported: newSerials.length,
      alreadyExisted: existingSet.size,
      duplicateRows,
      invalidRows,
      emptyRows,
      totalRows: serials.length,
    });
  } catch (e) {
    console.error("❌ importSerialNumbers error:", e);
    res.status(500).json({ error: "Import failed" });
  }
}

/* ---------------------------
   ADD A SINGLE SERIAL NUMBER MANUALLY
---------------------------- */
export async function addSerialNumber(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const validation = validateSerialNumber(req.body?.serial_number);

    if (!validation.valid) {
      return res.status(400).json({
        error: validation.error,
      });
    }

    const normalized = normalizeSerialForLookup(req.body?.serial_number);

    await pool.query(
      `INSERT INTO imported_serial_numbers (shop_id, serial_number) VALUES (?, ?)`,
      [shopId, normalized]
    );

    res.json({ success: true, serial_number: normalized });
  } catch (e) {
    if (e?.code === "ER_DUP_ENTRY") {
      return res
        .status(409)
        .json({ error: "This serial number has already been imported" });
    }
    console.error("❌ addSerialNumber error:", e);
    res.status(500).json({ error: "Failed to add serial number" });
  }
}

/* ---------------------------
   DELETE A SERIAL NUMBER
---------------------------- */
export async function deleteSerialNumber(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid serial number id" });
    }

    const [result] = await pool.query(
      `DELETE FROM imported_serial_numbers WHERE id = ? AND shop_id = ?`,
      [id, shopId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Serial number not found" });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("❌ deleteSerialNumber error:", e);
    res.status(500).json({ error: "Failed to delete serial number" });
  }
}

/* ---------------------------
   VALIDATE A SERIAL NUMBER (ADMIN / DEBUG USE)
   Reuses the exact same lookup registration relies on.
---------------------------- */
export async function validateSerialNumberHandler(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const serial = req.query.serial ?? req.body?.serial_number;

    const validation = validateSerialNumber(serial);

    if (!validation.valid) {
      return res.json({
        valid: false,
        error: validation.error,
      });
    }

    const valid = await isSerialNumberImported(shopId, serial);

    res.json({
      valid,
    });
  } catch (e) {
    console.error("❌ validateSerialNumberHandler error:", e);
    res.status(500).json({ error: "Validation failed" });
  }
}
