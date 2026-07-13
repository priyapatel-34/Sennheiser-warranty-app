// import { pool } from "../db/mysql.js";

// /**
//  * Store-specific serial number verification.
//  *
//  * Shared by:
//  *  - controllers/serialNumbers.controller.js (admin CRUD/import API)
//  *  - controllers/settings.controller.js (per-shop ON/OFF toggle)
//  *  - controllers/warranty.controller.js (registration-time validation)
//  *
//  * Kept in one place so the "is this serial allowed for this shop" logic
//  * is never duplicated.
//  */

// /** Serial numbers are stored/looked up normalized: trimmed + uppercased. */
// export function normalizeSerialForLookup(serial) {
//   return String(serial || "").trim().toUpperCase();
// }

// /**
//  * Whether the given shop has serial number verification enabled.
//  * Defaults to false (existing behaviour) when no row exists yet.
//  */
// export async function isSerialVerificationEnabled(shopId, queryable = pool) {
//   const [[row]] = await queryable.query(
//     "SELECT serial_verification_enabled FROM store_settings WHERE shop_id = ?",
//     [shopId]
//   );
//   return Boolean(row?.serial_verification_enabled);
// }

// /**
//  * Indexed lookup against imported_serial_numbers for this shop only.
//  * Pass an active transaction connection via `queryable` to reuse it,
//  * otherwise the pool is used.
//  */
// export async function isSerialNumberImported(shopId, serial, queryable = pool) {
//   const normalized = normalizeSerialForLookup(serial);
//   if (!shopId || !normalized) return false;

//   const [[row]] = await queryable.query(
//     `
//     SELECT id
//     FROM imported_serial_numbers
//     WHERE shop_id = ?
//       AND serial_number = ?
//     LIMIT 1
//     `,
//     [shopId, normalized]
//   );
//   return Boolean(row);
// }

import { pool } from "../db/mysql.js";

/**
 * Store-specific serial number verification.
 *
 * Shared by:
 *  - controllers/serialNumbers.controller.js
 *  - controllers/settings.controller.js
 *  - controllers/warranty.controller.js
 *
 * Single source of truth for:
 *  - Serial normalization
 *  - Serial validation
 *  - Store verification settings
 *  - Imported serial lookup
 */

/**
 * Allowed format:
 * - Letters and numbers only
 * - 10–20 characters
 *
 * If your business later requires hyphens, change this to:
 * /^[A-Z0-9-]{10,20}$/
 */
export const SERIAL_FORMAT_REGEX = /^[A-Z0-9]{10,20}$/;

/**
 * Normalize serial numbers before validation/storage/lookup.
 */
export function normalizeSerialForLookup(serial) {
  return String(serial || "")
    .trim()
    .toUpperCase();
}

/**
 * Validate serial number format.
 *
 * Returns:
 * {
 *   valid: boolean,
 *   error: string | null
 * }
 */
export function validateSerialNumber(serial) {
  const normalized = normalizeSerialForLookup(serial);

  if (!normalized) {
    return {
      valid: false,
      error: "Serial number is required",
    };
  }

  if (normalized.length < 10) {
    return {
      valid: false,
      error: "Minimum 10 characters required",
    };
  }

  if (normalized.length > 20) {
    return {
      valid: false,
      error: "Maximum 20 characters allowed",
    };
  }

  if (!SERIAL_FORMAT_REGEX.test(normalized)) {
    return {
      valid: false,
      error: "Only letters and numbers are allowed",
    };
  }

  return {
    valid: true,
    error: null,
  };
}

/**
 * Whether the given shop has serial verification enabled.
 *
 * Existing stores default to FALSE.
 */
export async function isSerialVerificationEnabled(
  shopId,
  queryable = pool
) {
  const [[row]] = await queryable.query(
    `
    SELECT serial_verification_enabled
    FROM store_settings
    WHERE shop_id = ?
    `,
    [shopId]
  );

  return Boolean(row?.serial_verification_enabled);
}

/**
 * Checks whether a serial number has been imported
 * for the current shop.
 */
export async function isSerialNumberImported(
  shopId,
  serial,
  queryable = pool
) {
  const normalized = normalizeSerialForLookup(serial);

  if (!shopId || !normalized) {
    return false;
  }

  const [[row]] = await queryable.query(
    `
    SELECT id
    FROM imported_serial_numbers
    WHERE shop_id = ?
      AND serial_number = ?
    LIMIT 1
    `,
    [shopId, normalized]
  );

  return Boolean(row);
}