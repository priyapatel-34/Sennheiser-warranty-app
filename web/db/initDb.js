// import { pool } from "./mysql.js";

// // ── Schema cache ─────────────────────────────────────────────────────────────
// // Loaded once at the start of ensureSchemaUpdates() — replaces 30+ individual
// // information_schema round-trips with two bulk queries (~1-2 s → ~100 ms).

// let _columnCache = null;   // Set<"table.column">
// let _indexCache = null;   // Set<"table.indexName">

// /**
//  * Loads information_schema metadata once so schema checks can reuse cached
//  * column and index lookups instead of issuing one query per migration check.
//  */
// async function loadSchemaCache() {
//   const [colRows] = await pool.query(`
//     SELECT TABLE_NAME, COLUMN_NAME
//     FROM information_schema.COLUMNS
//     WHERE TABLE_SCHEMA = DATABASE()
//   `);
//   _columnCache = new Set(colRows.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));

//   const [idxRows] = await pool.query(`
//     SELECT TABLE_NAME, INDEX_NAME
//     FROM information_schema.STATISTICS
//     WHERE TABLE_SCHEMA = DATABASE()
//   `);
//   _indexCache = new Set(idxRows.map((r) => `${r.TABLE_NAME}.${r.INDEX_NAME}`));
// }

// /**
//  * Checks whether a cached table column exists in the current database schema.
//  */
// function columnExists(table, column) {
//   return Promise.resolve(_columnCache.has(`${table}.${column}`));
// }

// /**
//  * Checks whether a cached index exists in the current database schema.
//  */
// function indexExists(table, indexName) {
//   return Promise.resolve(_indexCache.has(`${table}.${indexName}`));
// }

// /** Additive schema updates for existing installs (no migration framework). */
// /**
//  * Applies non-destructive schema changes so older installs can keep pace with
//  * newer app features without requiring a formal migration engine.
//  */
// async function ensureSchemaUpdates() {
//   // Pre-load all column/index metadata in two queries instead of 30+ individual
//   // information_schema round-trips.  This is the main source of slow cold starts.
//   await loadSchemaCache();
//   const emailSettingsUrlColumns = [
//     "store_url",
//     "privacy_policy_url",
//     "terms_conditions_url",
//     "support_url",
//   ];
//   for (const column of emailSettingsUrlColumns) {
//     if (!(await columnExists("email_settings", column))) {
//       await pool.query(
//         `ALTER TABLE email_settings ADD COLUMN ${column} VARCHAR(2048) NULL`
//       );
//     }
//   }
//   if (!(await columnExists("registered_products", "shopify_variant_id"))) {
//     await pool.query(`
//       ALTER TABLE registered_products
//       ADD COLUMN shopify_variant_id VARCHAR(100) NULL AFTER shopify_product_id
//     `);
//   }

//   const planColumns = [
//     ["coverage_text", "TEXT NULL AFTER status"],
//     [
//       "shopify_checkout_variant_id",
//       "BIGINT NULL AFTER coverage_text",
//     ],
//     [
//       "shopify_checkout_product_id",
//       "BIGINT NULL AFTER shopify_checkout_variant_id",
//     ],
//     [
//       "checkout_variant_synced_at",
//       "TIMESTAMP NULL AFTER shopify_checkout_product_id",
//     ],
//   ];

//   for (const [col, definition] of planColumns) {
//     if (!(await columnExists("extended_warranty_plans", col))) {
//       await pool.query(
//         `ALTER TABLE extended_warranty_plans ADD COLUMN ${col} ${definition}`
//       );
//     }
//   }

//   const entitlementColumns = [
//     ["refund_amount", "DECIMAL(10, 2) NULL AFTER expiry_date"],
//     ["refunded_at", "TIMESTAMP NULL AFTER refund_amount"],
//     [
//       "shopify_parent_line_item_id",
//       "VARCHAR(100) NULL AFTER shopify_order_id",
//     ],
//     [
//       "shopify_product_id",
//       "VARCHAR(100) NULL AFTER shopify_parent_line_item_id",
//     ],
//     [
//       "shopify_variant_id",
//       "VARCHAR(100) NULL AFTER shopify_product_id",
//     ],
//     ["customer_email", "VARCHAR(255) NULL AFTER shopify_variant_id"],
//     [
//       "source",
//       "VARCHAR(50) NULL DEFAULT 'registration' AFTER customer_email",
//     ],
//   ];

//   for (const [col, definition] of entitlementColumns) {
//     if (!(await columnExists("extended_warranty_entitlements", col))) {
//       await pool.query(
//         `ALTER TABLE extended_warranty_entitlements ADD COLUMN ${col} ${definition}`
//       );
//     }
//   }

//   const [entitlementRegisterCol] = await pool.query(`
//     SELECT IS_NULLABLE
//     FROM information_schema.COLUMNS
//     WHERE TABLE_SCHEMA = DATABASE()
//       AND TABLE_NAME = 'extended_warranty_entitlements'
//       AND COLUMN_NAME = 'registered_product_id'
//   `);
//   if (entitlementRegisterCol[0]?.IS_NULLABLE === "NO") {
//     const [fks] = await pool.query(`
//       SELECT CONSTRAINT_NAME
//       FROM information_schema.KEY_COLUMN_USAGE
//       WHERE TABLE_SCHEMA = DATABASE()
//         AND TABLE_NAME = 'extended_warranty_entitlements'
//         AND COLUMN_NAME = 'registered_product_id'
//         AND REFERENCED_TABLE_NAME IS NOT NULL
//     `);
//     for (const fk of fks) {
//       await pool.query(
//         `ALTER TABLE extended_warranty_entitlements DROP FOREIGN KEY ${fk.CONSTRAINT_NAME}`
//       );
//     }
//     await pool.query(`
//       ALTER TABLE extended_warranty_entitlements
//       MODIFY registered_product_id BIGINT NULL
//     `);
//     await pool.query(`
//       ALTER TABLE extended_warranty_entitlements
//       ADD CONSTRAINT fk_ew_ent_registered_product
//       FOREIGN KEY (registered_product_id) REFERENCES registered_products(id)
//       ON DELETE CASCADE
//     `);
//   }

//   if (!(await indexExists("extended_warranty_entitlements", "idx_ew_ent_shop_parent_line"))) {
//     await pool.query(`
//       CREATE INDEX idx_ew_ent_shop_parent_line
//       ON extended_warranty_entitlements (shop_id, shopify_order_id, shopify_parent_line_item_id)
//     `);
//   }

//   const searchIndexes = [
//     ["registered_products", "idx_rp_shop_customer_email", "shop_id, customer_email"],
//     ["registered_products", "idx_rp_shop_serial", "shop_id, serial_number"],
//     ["registered_products", "idx_rp_shop_product_name", "shop_id, product_name"],
//     ["registered_products", "idx_rp_shop_created", "shop_id, created_at"],
//     ["registered_products", "idx_rp_shop_purchase_type", "shop_id, purchase_type"],
//   ];

//   for (const [table, indexName, columns] of searchIndexes) {
//     if (!(await indexExists(table, indexName))) {
//       await pool.query(`CREATE INDEX ${indexName} ON ${table} (${columns})`);
//     }
//   }

//   if (!(await indexExists("registered_products", "uniq_shop_line_item"))) {
//     await pool.query(`
//       DELETE rp1
//       FROM registered_products rp1
//       INNER JOIN registered_products rp2
//         ON rp1.shop_id = rp2.shop_id
//        AND rp1.shopify_line_item_id = rp2.shopify_line_item_id
//        AND rp1.shopify_line_item_id IS NOT NULL
//        AND rp1.id < rp2.id
//     `);

//     await pool.query(`
//       ALTER TABLE registered_products
//       ADD UNIQUE KEY uniq_shop_line_item (shop_id, shopify_line_item_id)
//     `);
//   }

//   const refundRecordColumns = [
//     ["customer_email", "VARCHAR(255) NULL AFTER shopify_refund_id"],
//     ["customer_name", "VARCHAR(255) NULL AFTER customer_email"],
//     ["product_name", "VARCHAR(255) NULL AFTER customer_name"],
//     ["product_sku", "VARCHAR(100) NULL AFTER product_name"],
//     ["serial_number", "VARCHAR(100) NULL AFTER product_sku"],
//     ["warranty_plan", "VARCHAR(255) NULL AFTER serial_number"],
//     ["purchase_price", "DECIMAL(10, 2) NULL AFTER warranty_plan"],
//     ["purchase_date", "DATE NULL AFTER purchase_price"],
//     ["cancellation_date", "DATE NULL AFTER purchase_date"],
//     ["coverage_start_date", "DATE NULL AFTER cancellation_date"],
//     ["coverage_end_date", "DATE NULL AFTER coverage_start_date"],
//     ["days_total", "INT NULL AFTER coverage_end_date"],
//     ["days_used", "INT NOT NULL DEFAULT 0 AFTER days_total"],
//     ["used_value", "DECIMAL(10, 2) NULL AFTER remaining_days"],
//     ["remaining_value", "DECIMAL(10, 2) NULL AFTER used_value"],
//     ["pro_rata_refund_amount", "DECIMAL(10, 2) NULL AFTER remaining_value"],
//     ["claim_cost_deducted", "DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER pro_rata_refund_amount"],
//     ["net_refund_amount", "DECIMAL(10, 2) NULL AFTER claim_cost_deducted"],
//     ["refund_type", "ENUM('full','pro_rata','net') NULL AFTER currency"],
//     ["refund_trigger", "VARCHAR(50) NULL AFTER refund_type"],
//     ["refund_reason", "TEXT NULL AFTER refund_trigger"],
//     ["calculation_breakdown", "JSON NULL AFTER calculation_notes"],
//     ["admin_notes", "TEXT NULL AFTER calculation_breakdown"],
//     ["approved_at", "TIMESTAMP NULL AFTER admin_notes"],
//     ["approved_by", "VARCHAR(255) NULL AFTER approved_at"],
//     ["rejected_at", "TIMESTAMP NULL AFTER approved_by"],
//     ["rejected_by", "VARCHAR(255) NULL AFTER rejected_at"],
//     ["rejection_reason", "TEXT NULL AFTER rejected_by"],
//     ["completed_at", "TIMESTAMP NULL AFTER rejection_reason"],
//     ["completed_by", "VARCHAR(255) NULL AFTER completed_at"],
//     [
//       "updated_at",
//       "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at",
//     ],
//   ];

//   for (const [col, definition] of refundRecordColumns) {
//     if (!(await columnExists("extended_warranty_refund_records", col))) {
//       await pool.query(
//         `ALTER TABLE extended_warranty_refund_records ADD COLUMN ${col} ${definition}`
//       );
//     }
//   }

//   const refundSettingsColumns = [
//     ["eligibility_window_days", "INT NULL AFTER minimum_used_days"],
//     ["auto_cancel_entitlement", "TINYINT(1) NOT NULL DEFAULT 1 AFTER cancel_on_refund"],
//     [
//       "finance_notification_emails",
//       "TEXT NULL AFTER auto_cancel_entitlement",
//     ],
//   ];

//   for (const [col, definition] of refundSettingsColumns) {
//     if (!(await columnExists("extended_warranty_refund_settings", col))) {
//       await pool.query(
//         `ALTER TABLE extended_warranty_refund_settings ADD COLUMN ${col} ${definition}`
//       );
//     }
//   }

//   await pool.query(`
//     CREATE TABLE IF NOT EXISTS extended_warranty_refund_audit (
//       id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//       refund_record_id BIGINT UNSIGNED NOT NULL,
//       shop_id BIGINT UNSIGNED NOT NULL,
//       action VARCHAR(50) NOT NULL,
//       actor VARCHAR(255) NULL,
//       details JSON NULL,
//       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//       INDEX idx_refund_audit_refund (refund_record_id),
//       INDEX idx_refund_audit_shop (shop_id),
//       FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
//     )
//   `);

//   try {
//     await pool.query(`
//       ALTER TABLE extended_warranty_refund_records
//       MODIFY status ENUM(
//         'pending_review',
//         'approved',
//         'rejected',
//         'refunded',
//         'cancelled',
//         'disputed',
//         'calculated',
//         'processed',
//         'pending_finance_action'
//       ) NOT NULL DEFAULT 'pending_review'
//     `);
//   } catch (err) {
//     console.warn("⚠️ Refund status enum update skipped:", err.message);
//   }

//   const refundIndexes = [
//     ["extended_warranty_refund_records", "idx_ew_refund_shop_status", "shop_id, status"],
//     ["extended_warranty_refund_records", "idx_ew_refund_created", "shop_id, created_at"],
//   ];

//   for (const [table, indexName, columns] of refundIndexes) {
//     if (!(await indexExists(table, indexName))) {
//       await pool.query(`CREATE INDEX ${indexName} ON ${table} (${columns})`);
//     }
//   }

//   if (!(await columnExists("extended_warranty_durations", "merchandising_badge"))) {
//     await pool.query(`
//       ALTER TABLE extended_warranty_durations
//       ADD COLUMN merchandising_badge VARCHAR(50) NULL AFTER plan_name
//     `);
//   }

//   const ewSettingsColumns = [
//     ["extended_warranty_purchase_days", "INT NULL AFTER coverage_text"],
//     [
//       "warranty_pricing_type",
//       "ENUM('amount', 'percentage') NOT NULL DEFAULT 'amount' AFTER extended_warranty_purchase_days",
//     ],
//     [
//       "extended_warranty_offer_enabled",
//       "TINYINT(1) NOT NULL DEFAULT 1 AFTER warranty_pricing_type",
//     ],
//     [
//       "shopify_checkout_product_id",
//       "BIGINT NULL AFTER extended_warranty_offer_enabled",
//     ],
//     [
//       "allowed_product_types",
//       "TEXT NULL AFTER shopify_checkout_product_id",
//     ],
//   ];

//   for (const [col, definition] of ewSettingsColumns) {
//     if (!(await columnExists("extended_warranty_settings", col))) {
//       if (
//         col === "extended_warranty_purchase_days" &&
//         (await columnExists("extended_warranty_settings", "default_purchase_window_days"))
//       ) {
//         await pool.query(`
//           ALTER TABLE extended_warranty_settings
//           CHANGE COLUMN default_purchase_window_days extended_warranty_purchase_days INT NULL
//         `);
//       } else {
//         await pool.query(
//           `ALTER TABLE extended_warranty_settings ADD COLUMN ${col} ${definition}`
//         );
//       }
//     }
//   }

//   const ewSettingsDropColumns = [
//     "use_dynamic_plan_badges",
//     "default_warranty_image_url",
//     "store_display_name",
//     "default_purchase_window_days",
//     "region_code",
//     "enabled",
//     "offer_after_registration",
//   ];

//   for (const col of ewSettingsDropColumns) {
//     if (await columnExists("extended_warranty_settings", col)) {
//       await pool.query(
//         `ALTER TABLE extended_warranty_settings DROP COLUMN ${col}`
//       );
//     }
//   }

//   if (await columnExists("extended_warranty_plans", "region_code")) {
//     await pool.query(`ALTER TABLE extended_warranty_plans DROP COLUMN region_code`);
//   }

//   try {
//     await pool.query(`DROP TABLE IF EXISTS extended_warranty_purchase_windows`);
//   } catch (err) {
//     console.warn("⚠️ Purchase windows table drop skipped:", err.message);
//   }

//   await pool.query(`
//     CREATE TABLE IF NOT EXISTS extended_warranty_eligibility_reminders (
//       id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//       shop_id BIGINT UNSIGNED NOT NULL,
//       registered_product_id BIGINT NOT NULL,
//       reminder_days INT UNSIGNED NOT NULL,
//       sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//       UNIQUE KEY uniq_ew_eligibility_reminder (registered_product_id, reminder_days),
//       INDEX idx_ew_reminder_shop (shop_id),
//       FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
//       FOREIGN KEY (registered_product_id) REFERENCES registered_products(id) ON DELETE CASCADE
//     )
//   `);

//   if (
//     await columnExists("extended_warranty_eligibility_reminders", "reminder_days")
//   ) {
//     try {
//       await pool.query(`
//         ALTER TABLE extended_warranty_eligibility_reminders
//         MODIFY reminder_days INT UNSIGNED NOT NULL
//       `);
//     } catch (err) {
//       console.warn("⚠️ eligibility reminder_days column widen skipped:", err.message);
//     }
//   }

//   await pool.query(`
//     CREATE TABLE IF NOT EXISTS extended_warranty_expiry_reminder_configs (
//       id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//       shop_id BIGINT UNSIGNED NOT NULL,
//       country_code VARCHAR(10) NOT NULL,
//       reminder_days INT UNSIGNED NOT NULL,
//       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//         ON UPDATE CURRENT_TIMESTAMP,
//       UNIQUE KEY uniq_ew_expiry_reminder (shop_id, country_code, reminder_days),
//       INDEX idx_ew_expiry_reminder_shop (shop_id),
//       FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
//     )
//   `);

//   if (!(await columnExists("registered_products", "country_code"))) {
//     await pool.query(`
//       ALTER TABLE registered_products
//       ADD COLUMN country_code VARCHAR(10) NULL AFTER purchase_type
//     `);
//   }

//    // India-only free extended warranty metadata. Additive so existing
//   // registrations retain their current warranty state unchanged.
//   const freeWarrantyColumns = [
//     ["free_extended_warranty", "TINYINT(1) NOT NULL DEFAULT 0 AFTER warranty_end"],
//     ["free_extended_warranty_source", "VARCHAR(50) NULL AFTER free_extended_warranty"],
//     ["free_extended_warranty_start", "DATE NULL AFTER free_extended_warranty_source"],
//     ["free_extended_warranty_end", "DATE NULL AFTER free_extended_warranty_start"],
//     ["preorder_product", "TINYINT(1) NOT NULL DEFAULT 0 AFTER free_extended_warranty_end"],
//   ];
//   for (const [col, definition] of freeWarrantyColumns) {
//     if (!(await columnExists("registered_products", col))) {
//       await pool.query(`ALTER TABLE registered_products ADD COLUMN ${col} ${definition}`);
//     }
//   }

//   if (
//     !(await columnExists(
//       "registered_products",
//       "extended_warranty_offer_enabled_at_registration"
//     ))
//   ) {
//     await pool.query(`
//       ALTER TABLE registered_products
//       ADD COLUMN extended_warranty_offer_enabled_at_registration TINYINT(1) NULL
//       AFTER consent_marketing
//     `);
//   }

//   if (!(await columnExists("registered_products", "customer_locale"))) {
//     await pool.query(`
//       ALTER TABLE registered_products
//       ADD COLUMN customer_locale VARCHAR(16) NULL AFTER customer_name
//     `);
//   }

//   if (!(await columnExists("extended_warranty_entitlements", "customer_locale"))) {
//     await pool.query(`
//       ALTER TABLE extended_warranty_entitlements
//       ADD COLUMN customer_locale VARCHAR(16) NULL AFTER customer_email
//     `);
//   }

//   if (!(await columnExists("email_template_settings", "strings_json"))) {
//     await pool.query(`
//       ALTER TABLE email_template_settings
//       ADD COLUMN strings_json MEDIUMTEXT NULL AFTER body_html
//     `);
//   }

//   if (!(await columnExists("email_template_settings", "language_code"))) {
//     await pool.query(`
//       ALTER TABLE email_template_settings
//       ADD COLUMN language_code VARCHAR(16) NOT NULL DEFAULT 'en' AFTER template_key
//     `);
//   }

//   if (!(await indexExists("email_template_settings", "uniq_shop_email_template_lang"))) {
//     await pool.query(`
//       ALTER TABLE email_template_settings
//       ADD UNIQUE KEY uniq_shop_email_template_lang (shop_id, template_key, language_code)
//     `);
//   }

//   if (await indexExists("email_template_settings", "uniq_shop_email_template")) {
//     await pool.query(`
//       ALTER TABLE email_template_settings
//       DROP INDEX uniq_shop_email_template
//     `);
//   }

//   if (!(await columnExists("extended_warranty_entitlements", "pricing_type"))) {
//     await pool.query(`
//       ALTER TABLE extended_warranty_entitlements
//       ADD COLUMN pricing_type ENUM('amount', 'percentage') NOT NULL DEFAULT 'amount' AFTER currency
//     `);
//   }

//   if (!(await columnExists("retailers", "retailer_name_ja"))) {
//     await pool.query(`
//       ALTER TABLE retailers
//       ADD COLUMN retailer_name_ja VARCHAR(255) NULL AFTER retailer_name
//     `);
//   }

  
//   // Remove unpaid pending-payment leftovers so they cannot appear as
//   // registered warranties. Paid active rows are left untouched.
//   try {
//     const [pendingResult] = await pool.query(`
//       DELETE FROM extended_warranty_entitlements
//       WHERE status = 'pending_payment'
//     `);
//     if (pendingResult?.affectedRows) {
//       console.log(
//         `✅ Removed ${pendingResult.affectedRows} pending_payment entitlement(s)`
//       );
//     }
//   } catch (err) {
//     console.warn("⚠️ pending_payment entitlement cleanup skipped:", err.message);
//   }

//   if (await columnExists("extended_warranty_entitlements", "shopify_draft_order_id")) {
//     try {
//       const [draftResult] = await pool.query(`
//         DELETE FROM extended_warranty_entitlements
//         WHERE status = 'active'
//           AND shopify_draft_order_id IS NOT NULL
//           AND TRIM(shopify_draft_order_id) != ''
//           AND (shopify_order_id IS NULL OR TRIM(shopify_order_id) = '')
//       `);
//       if (draftResult?.affectedRows) {
//         console.log(
//           `✅ Removed ${draftResult.affectedRows} unpaid draft-order entitlement(s)`
//         );
//       }
//     } catch (err) {
//       console.warn("⚠️ unpaid draft-order entitlement cleanup skipped:", err.message);
//     }

//     try {
//       await pool.query(`
//         ALTER TABLE extended_warranty_entitlements
//         DROP COLUMN shopify_draft_order_id
//       `);
//     } catch (err) {
//       console.warn("⚠️ shopify_draft_order_id drop skipped:", err.message);
//     }
//   }

//   try {
//     await pool.query(`
//       ALTER TABLE extended_warranty_entitlements
//       MODIFY COLUMN status ENUM(
//         'active',
//         'expired',
//         'cancelled',
//         'refunded'
//       ) NOT NULL DEFAULT 'cancelled'
//     `);
//   } catch (err) {
//     console.warn("⚠️ pending_payment status enum cleanup skipped:", err.message);
//   }
// }

// /**
//  * Creates the project database tables and applies additive schema updates at
//  * startup before the server begins accepting requests.
//  */
// export async function initDb() {
//   try {
//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS shops (
//         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,                 -- Shopify Shop ID (gid numeric)
//         shop_domain VARCHAR(255) NOT NULL,
//         access_token VARCHAR(255) NOT NULL,

//         is_installed BOOLEAN NOT NULL DEFAULT TRUE,
//         installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//         uninstalled_at TIMESTAMP NULL,

//         scope TEXT NOT NULL,                   -- granted scopes
//         app_version VARCHAR(50) NULL,          -- helpful during migrations

//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//           ON UPDATE CURRENT_TIMESTAMP,

//         UNIQUE KEY uniq_shop_domain (shop_domain)
//       )
//     `);


//     await pool.query(`
//         CREATE TABLE IF NOT EXISTS retailers (
//           id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//           shop_id BIGINT UNSIGNED NOT NULL,
    
//           retailer_name VARCHAR(255) NOT NULL,
//           retailer_code VARCHAR(100) NULL,
//           retailer_type ENUM('online','offline','both') DEFAULT 'offline',
    
//           retailer_city VARCHAR(100) NULL,
//           retailer_email VARCHAR(255) NULL,
//           retailer_phone VARCHAR(50) NULL,
    
//           is_active TINYINT(1) DEFAULT 1,
    
//           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//           updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//             ON UPDATE CURRENT_TIMESTAMP,
    
//           UNIQUE KEY uniq_shop_retailer (shop_id, retailer_name),
//           FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
//         )
//       `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS standard_warranty_durations (
//         id INT AUTO_INCREMENT PRIMARY KEY,
//         shop_id BIGINT UNSIGNED NOT NULL,
//         months INT NOT NULL,
//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

//         UNIQUE KEY uk_shop_years (shop_id, months),
//         CONSTRAINT fk_swd_shop
//           FOREIGN KEY (shop_id)
//           REFERENCES shops(id)
//           ON DELETE CASCADE
//       )  
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS product_standard_warranty_durations (
//         id BIGINT PRIMARY KEY AUTO_INCREMENT,
//         shop_id BIGINT UNSIGNED NOT NULL,
//         product_id BIGINT NOT NULL,
//         duration_months INT NOT NULL,
//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
//         UNIQUE KEY uniq_shop_product (shop_id, product_id),
//         FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
//       )  
//     `);



//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS registered_products (
//         id BIGINT AUTO_INCREMENT PRIMARY KEY,

//         -- Multi-store support
//        shop_id BIGINT UNSIGNED NOT NULL,

//         -- Customer
//         customer_id VARCHAR(100),
//         customer_email VARCHAR(255) NOT NULL,
//         customer_name VARCHAR(255),
//         customer_locale VARCHAR(16) NULL,

//         -- Flow type
//         purchase_type ENUM('shopify', 'external') NOT NULL,

//         -- Shopify-specific
//         shopify_order_id VARCHAR(100),
//         shopify_line_item_id VARCHAR(100),
//         shopify_product_id VARCHAR(100),
//         sku VARCHAR(100),

//         -- Common product info
//         product_name VARCHAR(255) NOT NULL,
//         serial_number VARCHAR(255) NOT NULL,

//         -- External-specific
//         retailer_name VARCHAR(255),
//         purchase_date DATE,

//         -- Warranty
//         warranty_start DATE NOT NULL,
//         warranty_end DATE NOT NULL,
//         free_extended_warranty BOOLEAN NOT NULL DEFAULT 0,
//         free_extended_warranty_source VARCHAR(50) NULL,
//         free_extended_warranty_start DATE NULL,
//         free_extended_warranty_end DATE NULL,
//         preorder_product BOOLEAN NOT NULL DEFAULT 0,

//         -- Consent
//         consent_terms BOOLEAN NOT NULL DEFAULT 0,
//         consent_marketing BOOLEAN DEFAULT 0,

//         -- Metadata
//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

//         UNIQUE KEY uniq_serial_per_store (shop_id, serial_number),
//         FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
//       )
//     `);

//     /* -----------------------------
//       STORE SETTINGS TABLE
//       (Retailer Required Toggle)
//    ------------------------------ */
//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS store_settings (
//         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//         shop_id BIGINT UNSIGNED NOT NULL,

//         retailer_required TINYINT(1) NOT NULL DEFAULT 1,

//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//           ON UPDATE CURRENT_TIMESTAMP,

//         UNIQUE KEY uniq_shop (shop_id),
//         FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
//       )
//     `);

//     /* -----------------------------
//        EXTENDED WARRANTY DURATIONS
//        (Shop-level configurable duration options)
//     ------------------------------ */
//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS extended_warranty_durations (
//         id INT AUTO_INCREMENT PRIMARY KEY,
//         shop_id BIGINT UNSIGNED NOT NULL,
//         duration_months INT NOT NULL,
//         duration_years INT NOT NULL,
//         plan_name VARCHAR(255) NOT NULL,
//         merchandising_badge VARCHAR(50) NULL,
//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

//         UNIQUE KEY uk_shop_ew_duration (shop_id, duration_months),
//         CONSTRAINT fk_ewd_shop
//           FOREIGN KEY (shop_id)
//           REFERENCES shops(id)
//           ON DELETE CASCADE
//       )
//     `);

//     /* -----------------------------
//        EXTENDED WARRANTY PLANS
//        (Per-variant pricing mapped to Shopify products)
//     ------------------------------ */
//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS extended_warranty_plans (
//         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//         shop_id BIGINT UNSIGNED NOT NULL,
//         shopify_product_id BIGINT NOT NULL,
//         shopify_variant_id BIGINT NOT NULL,
//         plan_name VARCHAR(255) NOT NULL,
//         duration_years INT NOT NULL,
//         duration_months INT NOT NULL,
//         price DECIMAL(10, 2) NOT NULL,
//         currency VARCHAR(10) NOT NULL DEFAULT 'USD',
//         status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//           ON UPDATE CURRENT_TIMESTAMP,

//         UNIQUE KEY uniq_shop_variant_duration (shop_id, shopify_variant_id, duration_months),
//         INDEX idx_shop_product (shop_id, shopify_product_id),
//         FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
//       )
//     `);

//     /* -----------------------------
//        EXTENDED WARRANTY SETTINGS
//        (Per-store configuration: terms, coverage, branding)
//     ------------------------------ */
//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS extended_warranty_settings (
//         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//         shop_id BIGINT UNSIGNED NOT NULL,
//         terms_url VARCHAR(500) NULL,
//         coverage_text TEXT NULL,
//         extended_warranty_purchase_days INT NULL,
//         warranty_pricing_type ENUM('amount', 'percentage') NOT NULL DEFAULT 'amount',
//         extended_warranty_offer_enabled TINYINT(1) NOT NULL DEFAULT 0,
//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//           ON UPDATE CURRENT_TIMESTAMP,
//         UNIQUE KEY uniq_ew_settings_shop (shop_id),
//         FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
//       )
//     `);

//     /* -----------------------------
//        EXTENDED WARRANTY ENTITLEMENTS
//        (Purchase + activation records linked to registrations)
//     ------------------------------ */
//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS extended_warranty_entitlements (
//         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//         shop_id BIGINT UNSIGNED NOT NULL,
//         registered_product_id BIGINT NULL,
//         extended_warranty_plan_id BIGINT UNSIGNED NOT NULL,
//         shopify_order_id VARCHAR(100) NULL,
//         shopify_parent_line_item_id VARCHAR(100) NULL,
//         shopify_product_id VARCHAR(100) NULL,
//         shopify_variant_id VARCHAR(100) NULL,
//         customer_email VARCHAR(255) NULL,
//         customer_locale VARCHAR(16) NULL,
//         source VARCHAR(50) NULL DEFAULT 'registration',
//         status ENUM(
//           'active',
//           'expired',
//           'cancelled',
//           'refunded'
//         ) NOT NULL DEFAULT 'cancelled',
//         plan_name VARCHAR(255) NOT NULL,
//         duration_years INT NOT NULL,
//         duration_months INT NOT NULL,
//         price DECIMAL(10, 2) NOT NULL,
//         currency VARCHAR(10) NOT NULL,
//         pricing_type ENUM('amount', 'percentage') NOT NULL DEFAULT 'amount',
//         purchase_date DATE NULL,
//         activation_date DATE NULL,
//         expiry_date DATE NULL,
//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//           ON UPDATE CURRENT_TIMESTAMP,
//         INDEX idx_ew_ent_shop_register (shop_id, registered_product_id),
//         INDEX idx_ew_ent_order (shop_id, shopify_order_id),
//         FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
//         FOREIGN KEY (registered_product_id) REFERENCES registered_products(id) ON DELETE CASCADE,
//         FOREIGN KEY (extended_warranty_plan_id) REFERENCES extended_warranty_plans(id) ON DELETE CASCADE
//       )
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS extended_warranty_refund_settings (
//         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//         shop_id BIGINT UNSIGNED NOT NULL,
//         refund_enabled TINYINT(1) NOT NULL DEFAULT 0,
//         pro_rata_enabled TINYINT(1) NOT NULL DEFAULT 0,
//         refund_percentage DECIMAL(5, 2) NOT NULL DEFAULT 100.00,
//         cancel_on_refund TINYINT(1) NOT NULL DEFAULT 1,
//         minimum_used_days INT NOT NULL DEFAULT 0,
//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//           ON UPDATE CURRENT_TIMESTAMP,
//         UNIQUE KEY uniq_ew_refund_shop (shop_id),
//         FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
//       )
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS extended_warranty_refund_records (
//         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//         shop_id BIGINT UNSIGNED NOT NULL,
//         entitlement_id BIGINT UNSIGNED NOT NULL,
//         shopify_order_id VARCHAR(100) NULL,
//         shopify_refund_id VARCHAR(100) NULL,
//         original_amount DECIMAL(10, 2) NOT NULL,
//         calculated_refund_amount DECIMAL(10, 2) NOT NULL,
//         currency VARCHAR(10) NOT NULL,
//         total_coverage_days INT NOT NULL,
//         remaining_days INT NOT NULL,
//         refund_percentage_applied DECIMAL(5, 2) NOT NULL,
//         calculation_notes TEXT NULL,
//         status ENUM('calculated', 'processed', 'cancelled') NOT NULL DEFAULT 'calculated',
//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//         INDEX idx_ew_refund_ent (entitlement_id),
//         FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
//         FOREIGN KEY (entitlement_id) REFERENCES extended_warranty_entitlements(id) ON DELETE CASCADE
//       )
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS email_settings (
//         shop_id BIGINT UNSIGNED PRIMARY KEY,
//         global_enabled TINYINT(1) NOT NULL DEFAULT 0,
//         store_url VARCHAR(2048) NULL,
//         privacy_policy_url VARCHAR(2048) NULL,
//         terms_conditions_url VARCHAR(2048) NULL,
//         support_url VARCHAR(2048) NULL,
//         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
//         FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
//       )
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS email_template_settings (
//         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//         shop_id BIGINT UNSIGNED NOT NULL,
//         template_key VARCHAR(64) NOT NULL,
//         language_code VARCHAR(16) NOT NULL DEFAULT 'en',
//         enabled TINYINT(1) NOT NULL DEFAULT 1,
//         subject VARCHAR(500) NULL,
//         body_html MEDIUMTEXT NULL,
//         strings_json MEDIUMTEXT NULL,
//         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
//         UNIQUE KEY uniq_shop_email_template_lang (shop_id, template_key, language_code),
//         FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
//       )
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS shop_email_languages (
//         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//         shop_id BIGINT UNSIGNED NOT NULL,
//         language_code VARCHAR(16) NOT NULL,
//         is_default TINYINT(1) NOT NULL DEFAULT 0,
//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//         UNIQUE KEY uniq_shop_email_language (shop_id, language_code),
//         FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
//       )
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS extended_warranty_product_overrides (
//         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//         shop_id BIGINT UNSIGNED NOT NULL,
//         shopify_product_id BIGINT NOT NULL,
//         enabled TINYINT(1) NOT NULL DEFAULT 1,
//         created_by VARCHAR(255) NULL,
//         updated_by VARCHAR(255) NULL,
//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//           ON UPDATE CURRENT_TIMESTAMP,
//         UNIQUE KEY uniq_shop_ew_product_override (shop_id, shopify_product_id),
//         INDEX idx_ew_override_shop_enabled (shop_id, enabled),
//         FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
//       )
//     `);

//     await ensureSchemaUpdates();

//   } catch (err) {
//     console.error("❌ DB init failed:", err);
//     process.exit(1); // fail fast
//   }
// }

import { pool } from "./mysql.js";

// ── Schema cache ─────────────────────────────────────────────────────────────
// Loaded once at the start of ensureSchemaUpdates() — replaces 30+ individual
// information_schema round-trips with two bulk queries.
//
// The cache is kept in sync by the helpers below (addColumn / dropColumn /
// renameColumn / index helpers), so later checks in the same run never see
// stale data.

let _columnCache = null; // Map<"table.column", { type, nullable, defaultValue }>
let _indexCache = null; // Set<"table.indexName">
let _appliedChanges = 0;

async function loadSchemaCache() {
  const [colRows] = await pool.query(`
    SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS ty,
           IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
  `);
  _columnCache = new Map(
    colRows.map((r) => [
      `${r.t}.${r.c}`,
      { type: r.ty, nullable: r.nullable === "YES", defaultValue: r.def },
    ])
  );

  const [idxRows] = await pool.query(`
    SELECT TABLE_NAME AS t, INDEX_NAME AS i
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
  `);
  _indexCache = new Set(idxRows.map((r) => `${r.t}.${r.i}`));
}

const columnExists = (table, column) => _columnCache.has(`${table}.${column}`);
const getColumn = (table, column) => _columnCache.get(`${table}.${column}`);
const indexExists = (table, indexName) => _indexCache.has(`${table}.${indexName}`);

/** Normalises MySQL type/default strings so they can be compared safely. */
const norm = (v) =>
  String(v ?? "")
    .replace(/\s+/g, "")
    .replace(/^'(.*)'$/, "$1")
    .toLowerCase();

/**
 * True only when we are CERTAIN a NOT NULL column already has the expected
 * type + default. If anything is unknown we return false and the caller runs
 * the ALTER exactly like before, so this can only skip redundant work.
 */
function notNullColumnMatches(table, column, expectedType, expectedDefault) {
  const col = getColumn(table, column);
  if (!col || col.type == null || col.nullable) return false;
  return (
    norm(col.type) === norm(expectedType) &&
    norm(col.defaultValue) === norm(expectedDefault)
  );
}

async function addColumn(table, column, definition) {
  if (columnExists(table, column)) return false;
  await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  _columnCache.set(`${table}.${column}`, { type: null, nullable: true, defaultValue: null });
  _appliedChanges++;
  return true;
}

async function addColumns(table, columns) {
  for (const [column, definition] of columns) {
    await addColumn(table, column, definition);
  }
}

async function dropColumn(table, column) {
  if (!columnExists(table, column)) return false;
  await pool.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
  _columnCache.delete(`${table}.${column}`);
  _appliedChanges++;
  return true;
}

async function createIndex(table, indexName, columns) {
  if (indexExists(table, indexName)) return false;
  await pool.query(`CREATE INDEX \`${indexName}\` ON \`${table}\` (${columns})`);
  _indexCache.add(`${table}.${indexName}`);
  _appliedChanges++;
  return true;
}

async function dropIndex(table, indexName) {
  if (!indexExists(table, indexName)) return false;
  await pool.query(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``);
  _indexCache.delete(`${table}.${indexName}`);
  _appliedChanges++;
  return true;
}

// ── Migration lock ───────────────────────────────────────────────────────────
// On Azure App Service (or any scaled-out setup) several instances can boot at
// the same time. A MySQL advisory lock makes sure only one runs the ALTERs.
// If the lock can't be obtained in time, we skip: another instance is already
// doing the work, and CREATE TABLE IF NOT EXISTS above is safe to run anywhere.

const MIGRATION_LOCK_NAME = "app_schema_migration";
const MIGRATION_LOCK_TIMEOUT_SECONDS = 120;

async function withMigrationLock(fn) {
  const conn = await pool.getConnection();
  let locked = false;
  try {
    const [rows] = await conn.query("SELECT GET_LOCK(?, ?) AS ok", [
      MIGRATION_LOCK_NAME,
      MIGRATION_LOCK_TIMEOUT_SECONDS,
    ]);
    locked = Number(rows?.[0]?.ok) === 1;
    if (!locked) {
      console.warn("⚠️ Schema update skipped: another instance holds the migration lock");
      return;
    }
    await fn();
  } finally {
    if (locked) {
      await conn.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK_NAME]).catch(() => {});
    }
    conn.release();
  }
}

// ── Target definitions used to detect "already up to date" ───────────────────

const REFUND_STATUS_TYPE =
  "enum('pending_review','approved','rejected','refunded','cancelled','disputed','calculated','processed','pending_finance_action')";
const ENTITLEMENT_STATUS_TYPE = "enum('active','expired','cancelled','refunded')";

/** Additive schema updates for existing installs (no migration framework). */
async function ensureSchemaUpdates() {
  await loadSchemaCache();

  // ── email_settings ─────────────────────────────────────────────────────────
  await addColumns("email_settings", [
    ["store_url", "VARCHAR(2048) NULL"],
    ["privacy_policy_url", "VARCHAR(2048) NULL"],
    ["terms_conditions_url", "VARCHAR(2048) NULL"],
    ["support_url", "VARCHAR(2048) NULL"],
  ]);

  // ── registered_products ────────────────────────────────────────────────────
  await addColumn(
    "registered_products",
    "shopify_variant_id",
    "VARCHAR(100) NULL AFTER shopify_product_id"
  );

  // ── extended_warranty_plans ────────────────────────────────────────────────
  await addColumns("extended_warranty_plans", [
    ["coverage_text", "TEXT NULL AFTER status"],
    ["shopify_checkout_variant_id", "BIGINT NULL AFTER coverage_text"],
    ["shopify_checkout_product_id", "BIGINT NULL AFTER shopify_checkout_variant_id"],
    ["checkout_variant_synced_at", "TIMESTAMP NULL AFTER shopify_checkout_product_id"],
  ]);

  // ── extended_warranty_entitlements ─────────────────────────────────────────
  await addColumns("extended_warranty_entitlements", [
    ["refund_amount", "DECIMAL(10, 2) NULL AFTER expiry_date"],
    ["refunded_at", "TIMESTAMP NULL AFTER refund_amount"],
    ["shopify_parent_line_item_id", "VARCHAR(100) NULL AFTER shopify_order_id"],
    ["shopify_product_id", "VARCHAR(100) NULL AFTER shopify_parent_line_item_id"],
    ["shopify_variant_id", "VARCHAR(100) NULL AFTER shopify_product_id"],
    ["customer_email", "VARCHAR(255) NULL AFTER shopify_variant_id"],
    ["source", "VARCHAR(50) NULL DEFAULT 'registration' AFTER customer_email"],
  ]);

  // registered_product_id must be nullable (entitlements can exist without a
  // registration, e.g. bought at checkout). Only runs on old installs.
  const regProductCol = getColumn("extended_warranty_entitlements", "registered_product_id");
  if (regProductCol && regProductCol.nullable === false) {
    const [fks] = await pool.query(`
      SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'extended_warranty_entitlements'
        AND COLUMN_NAME = 'registered_product_id'
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `);
    for (const fk of fks) {
      await pool.query(
        `ALTER TABLE extended_warranty_entitlements DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``
      );
    }
    await pool.query(`
      ALTER TABLE extended_warranty_entitlements
      MODIFY registered_product_id BIGINT NULL
    `);
    await pool.query(`
      ALTER TABLE extended_warranty_entitlements
      ADD CONSTRAINT fk_ew_ent_registered_product
      FOREIGN KEY (registered_product_id) REFERENCES registered_products(id)
      ON DELETE CASCADE
    `);
    regProductCol.nullable = true;
    _appliedChanges++;
  }

  await createIndex(
    "extended_warranty_entitlements",
    "idx_ew_ent_shop_parent_line",
    "shop_id, shopify_order_id, shopify_parent_line_item_id"
  );

  // ── registered_products: search indexes ────────────────────────────────────
  const searchIndexes = [
    ["idx_rp_shop_customer_email", "shop_id, customer_email"],
    ["idx_rp_shop_serial", "shop_id, serial_number"],
    ["idx_rp_shop_product_name", "shop_id, product_name"],
    ["idx_rp_shop_created", "shop_id, created_at"],
    ["idx_rp_shop_purchase_type", "shop_id, purchase_type"],
  ];
  for (const [indexName, columns] of searchIndexes) {
    await createIndex("registered_products", indexName, columns);
  }

  // One-time: de-duplicate line items, then enforce uniqueness.
  if (!indexExists("registered_products", "uniq_shop_line_item")) {
    await pool.query(`
      DELETE rp1
      FROM registered_products rp1
      INNER JOIN registered_products rp2
        ON rp1.shop_id = rp2.shop_id
       AND rp1.shopify_line_item_id = rp2.shopify_line_item_id
       AND rp1.shopify_line_item_id IS NOT NULL
       AND rp1.id < rp2.id
    `);
    await pool.query(`
      ALTER TABLE registered_products
      ADD UNIQUE KEY uniq_shop_line_item (shop_id, shopify_line_item_id)
    `);
    _indexCache.add("registered_products.uniq_shop_line_item");
    _appliedChanges++;
  }

  // ── extended_warranty_refund_records ───────────────────────────────────────
  await addColumns("extended_warranty_refund_records", [
    ["customer_email", "VARCHAR(255) NULL AFTER shopify_refund_id"],
    ["customer_name", "VARCHAR(255) NULL AFTER customer_email"],
    ["product_name", "VARCHAR(255) NULL AFTER customer_name"],
    ["product_sku", "VARCHAR(100) NULL AFTER product_name"],
    ["serial_number", "VARCHAR(100) NULL AFTER product_sku"],
    ["warranty_plan", "VARCHAR(255) NULL AFTER serial_number"],
    ["purchase_price", "DECIMAL(10, 2) NULL AFTER warranty_plan"],
    ["purchase_date", "DATE NULL AFTER purchase_price"],
    ["cancellation_date", "DATE NULL AFTER purchase_date"],
    ["coverage_start_date", "DATE NULL AFTER cancellation_date"],
    ["coverage_end_date", "DATE NULL AFTER coverage_start_date"],
    ["days_total", "INT NULL AFTER coverage_end_date"],
    ["days_used", "INT NOT NULL DEFAULT 0 AFTER days_total"],
    ["used_value", "DECIMAL(10, 2) NULL AFTER remaining_days"],
    ["remaining_value", "DECIMAL(10, 2) NULL AFTER used_value"],
    ["pro_rata_refund_amount", "DECIMAL(10, 2) NULL AFTER remaining_value"],
    ["claim_cost_deducted", "DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER pro_rata_refund_amount"],
    ["net_refund_amount", "DECIMAL(10, 2) NULL AFTER claim_cost_deducted"],
    ["refund_type", "ENUM('full','pro_rata','net') NULL AFTER currency"],
    ["refund_trigger", "VARCHAR(50) NULL AFTER refund_type"],
    ["refund_reason", "TEXT NULL AFTER refund_trigger"],
    ["calculation_breakdown", "JSON NULL AFTER calculation_notes"],
    ["admin_notes", "TEXT NULL AFTER calculation_breakdown"],
    ["approved_at", "TIMESTAMP NULL AFTER admin_notes"],
    ["approved_by", "VARCHAR(255) NULL AFTER approved_at"],
    ["rejected_at", "TIMESTAMP NULL AFTER approved_by"],
    ["rejected_by", "VARCHAR(255) NULL AFTER rejected_at"],
    ["rejection_reason", "TEXT NULL AFTER rejected_by"],
    ["completed_at", "TIMESTAMP NULL AFTER rejection_reason"],
    ["completed_by", "VARCHAR(255) NULL AFTER completed_at"],
    [
      "updated_at",
      "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at",
    ],
  ]);

  // ── extended_warranty_refund_settings ──────────────────────────────────────
  await addColumns("extended_warranty_refund_settings", [
    ["eligibility_window_days", "INT NULL AFTER minimum_used_days"],
    ["auto_cancel_entitlement", "TINYINT(1) NOT NULL DEFAULT 1 AFTER cancel_on_refund"],
    ["finance_notification_emails", "TEXT NULL AFTER auto_cancel_entitlement"],
  ]);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS extended_warranty_refund_audit (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      refund_record_id BIGINT UNSIGNED NOT NULL,
      shop_id BIGINT UNSIGNED NOT NULL,
      action VARCHAR(50) NOT NULL,
      actor VARCHAR(255) NULL,
      details JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_refund_audit_refund (refund_record_id),
      INDEX idx_refund_audit_shop (shop_id),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
    )
  `);

  // Skipped when the column is already exactly what we want, so a normal
  // restart no longer triggers a table ALTER.
  if (
    !notNullColumnMatches(
      "extended_warranty_refund_records",
      "status",
      REFUND_STATUS_TYPE,
      "pending_review"
    )
  ) {
    try {
      await pool.query(`
        ALTER TABLE extended_warranty_refund_records
        MODIFY status ENUM(
          'pending_review',
          'approved',
          'rejected',
          'refunded',
          'cancelled',
          'disputed',
          'calculated',
          'processed',
          'pending_finance_action'
        ) NOT NULL DEFAULT 'pending_review'
      `);
      _appliedChanges++;
    } catch (err) {
      console.warn("⚠️ Refund status enum update skipped:", err.message);
    }
  }

  await createIndex("extended_warranty_refund_records", "idx_ew_refund_shop_status", "shop_id, status");
  await createIndex("extended_warranty_refund_records", "idx_ew_refund_created", "shop_id, created_at");

  // ── extended_warranty_durations ────────────────────────────────────────────
  await addColumn(
    "extended_warranty_durations",
    "merchandising_badge",
    "VARCHAR(50) NULL AFTER plan_name"
  );

  // ── extended_warranty_settings ─────────────────────────────────────────────
  const ewSettingsColumns = [
    ["extended_warranty_purchase_days", "INT NULL AFTER coverage_text"],
    [
      "warranty_pricing_type",
      "ENUM('amount', 'percentage') NOT NULL DEFAULT 'amount' AFTER extended_warranty_purchase_days",
    ],
    [
      "extended_warranty_offer_enabled",
      "TINYINT(1) NOT NULL DEFAULT 1 AFTER warranty_pricing_type",
    ],
    ["shopify_checkout_product_id", "BIGINT NULL AFTER extended_warranty_offer_enabled"],
    ["allowed_product_types", "TEXT NULL AFTER shopify_checkout_product_id"],
  ];

  for (const [col, definition] of ewSettingsColumns) {
    if (columnExists("extended_warranty_settings", col)) continue;

    if (
      col === "extended_warranty_purchase_days" &&
      columnExists("extended_warranty_settings", "default_purchase_window_days")
    ) {
      // Rename keeps the existing data.
      await pool.query(`
        ALTER TABLE extended_warranty_settings
        CHANGE COLUMN default_purchase_window_days extended_warranty_purchase_days INT NULL
      `);
      _columnCache.delete("extended_warranty_settings.default_purchase_window_days");
      _columnCache.set("extended_warranty_settings.extended_warranty_purchase_days", {
        type: null,
        nullable: true,
        defaultValue: null,
      });
      _appliedChanges++;
    } else {
      await addColumn("extended_warranty_settings", col, definition);
    }
  }

  const ewSettingsDropColumns = [
    "use_dynamic_plan_badges",
    "default_warranty_image_url",
    "store_display_name",
    "default_purchase_window_days",
    "region_code",
    "enabled",
    "offer_after_registration",
  ];
  for (const col of ewSettingsDropColumns) {
    await dropColumn("extended_warranty_settings", col);
  }

  await dropColumn("extended_warranty_plans", "region_code");

  try {
    await pool.query(`DROP TABLE IF EXISTS extended_warranty_purchase_windows`);
  } catch (err) {
    console.warn("⚠️ Purchase windows table drop skipped:", err.message);
  }

  // ── Reminder tables ────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS extended_warranty_eligibility_reminders (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      shop_id BIGINT UNSIGNED NOT NULL,
      registered_product_id BIGINT NOT NULL,
      reminder_days INT UNSIGNED NOT NULL,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_ew_eligibility_reminder (registered_product_id, reminder_days),
      INDEX idx_ew_reminder_shop (shop_id),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
      FOREIGN KEY (registered_product_id) REFERENCES registered_products(id) ON DELETE CASCADE
    )
  `);

  // Only widen when an older install still has a signed / non-matching type.
  const reminderDaysCol = getColumn("extended_warranty_eligibility_reminders", "reminder_days");
  if (
    reminderDaysCol?.type &&
    !/^int(\(\d+\))? unsigned$/i.test(reminderDaysCol.type)
  ) {
    try {
      await pool.query(`
        ALTER TABLE extended_warranty_eligibility_reminders
        MODIFY reminder_days INT UNSIGNED NOT NULL
      `);
      _appliedChanges++;
    } catch (err) {
      console.warn("⚠️ eligibility reminder_days column widen skipped:", err.message);
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS extended_warranty_expiry_reminder_configs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      shop_id BIGINT UNSIGNED NOT NULL,
      country_code VARCHAR(10) NOT NULL,
      reminder_days INT UNSIGNED NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_ew_expiry_reminder (shop_id, country_code, reminder_days),
      INDEX idx_ew_expiry_reminder_shop (shop_id),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
    )
  `);

  // ── registered_products: extra columns ─────────────────────────────────────
  await addColumn(
    "registered_products",
    "country_code",
    "VARCHAR(10) NULL AFTER purchase_type"
  );

  // India-only free extended warranty metadata. Additive so existing
  // registrations retain their current warranty state unchanged.
  await addColumns("registered_products", [
    ["free_extended_warranty", "TINYINT(1) NOT NULL DEFAULT 0 AFTER warranty_end"],
    ["free_extended_warranty_source", "VARCHAR(50) NULL AFTER free_extended_warranty"],
    ["free_extended_warranty_start", "DATE NULL AFTER free_extended_warranty_source"],
    ["free_extended_warranty_end", "DATE NULL AFTER free_extended_warranty_start"],
    ["preorder_product", "TINYINT(1) NOT NULL DEFAULT 0 AFTER free_extended_warranty_end"],
    [
      "extended_warranty_offer_enabled_at_registration",
      "TINYINT(1) NULL AFTER consent_marketing",
    ],
    ["customer_locale", "VARCHAR(16) NULL AFTER customer_name"],
  ]);

  await addColumn(
    "extended_warranty_entitlements",
    "customer_locale",
    "VARCHAR(16) NULL AFTER customer_email"
  );

  // ── email_template_settings ────────────────────────────────────────────────
  await addColumn("email_template_settings", "strings_json", "MEDIUMTEXT NULL AFTER body_html");
  await addColumn(
    "email_template_settings",
    "language_code",
    "VARCHAR(16) NOT NULL DEFAULT 'en' AFTER template_key"
  );

  // New composite unique key must exist BEFORE the old one is dropped.
  if (!indexExists("email_template_settings", "uniq_shop_email_template_lang")) {
    await pool.query(`
      ALTER TABLE email_template_settings
      ADD UNIQUE KEY uniq_shop_email_template_lang (shop_id, template_key, language_code)
    `);
    _indexCache.add("email_template_settings.uniq_shop_email_template_lang");
    _appliedChanges++;
  }
  await dropIndex("email_template_settings", "uniq_shop_email_template");

  // ── entitlements: pricing_type ─────────────────────────────────────────────
  await addColumn(
    "extended_warranty_entitlements",
    "pricing_type",
    "ENUM('amount', 'percentage') NOT NULL DEFAULT 'amount' AFTER currency"
  );

  // ── retailers ──────────────────────────────────────────────────────────────
  await addColumn(
    "retailers",
    "retailer_name_ja",
    "VARCHAR(255) NULL AFTER retailer_name"
  );

  // ── One-time cleanups of the retired pending_payment flow ──────────────────
  // Runs only while the status enum still contains 'pending_payment'. Once the
  // enum has been tightened below, no such rows can exist and this is skipped,
  // so a normal restart never issues a DELETE.
  const entStatusCol = getColumn("extended_warranty_entitlements", "status");
  if (entStatusCol?.type && /pending_payment/i.test(entStatusCol.type)) {
    try {
      const [pendingResult] = await pool.query(`
        DELETE FROM extended_warranty_entitlements
        WHERE status = 'pending_payment'
      `);
      if (pendingResult?.affectedRows) {
        console.log(`✅ Removed ${pendingResult.affectedRows} pending_payment entitlement(s)`);
      }
    } catch (err) {
      console.warn("⚠️ pending_payment entitlement cleanup skipped:", err.message);
    }
  }

  if (columnExists("extended_warranty_entitlements", "shopify_draft_order_id")) {
    try {
      const [draftResult] = await pool.query(`
        DELETE FROM extended_warranty_entitlements
        WHERE status = 'active'
          AND shopify_draft_order_id IS NOT NULL
          AND TRIM(shopify_draft_order_id) != ''
          AND (shopify_order_id IS NULL OR TRIM(shopify_order_id) = '')
      `);
      if (draftResult?.affectedRows) {
        console.log(`✅ Removed ${draftResult.affectedRows} unpaid draft-order entitlement(s)`);
      }
    } catch (err) {
      console.warn("⚠️ unpaid draft-order entitlement cleanup skipped:", err.message);
    }

    try {
      await dropColumn("extended_warranty_entitlements", "shopify_draft_order_id");
    } catch (err) {
      console.warn("⚠️ shopify_draft_order_id drop skipped:", err.message);
    }
  }

  // Tighten the status enum (must come AFTER the cleanup above). Skipped when
  // the column already matches, so restarts don't rebuild the table.
  if (
    !notNullColumnMatches(
      "extended_warranty_entitlements",
      "status",
      ENTITLEMENT_STATUS_TYPE,
      "cancelled"
    )
  ) {
    try {
      await pool.query(`
        ALTER TABLE extended_warranty_entitlements
        MODIFY COLUMN status ENUM(
          'active',
          'expired',
          'cancelled',
          'refunded'
        ) NOT NULL DEFAULT 'cancelled'
      `);
      _appliedChanges++;
    } catch (err) {
      console.warn("⚠️ pending_payment status enum cleanup skipped:", err.message);
    }
  }

  if (_appliedChanges > 0) {
    console.log(`✅ Schema updates applied: ${_appliedChanges} change(s)`);
  }
}

/**
 * Creates the project database tables and applies additive schema updates at
 * startup before the server begins accepting requests.
 */
export async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shops (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,                 -- Shopify Shop ID (gid numeric)
        shop_domain VARCHAR(255) NOT NULL,
        access_token VARCHAR(255) NOT NULL,

        is_installed BOOLEAN NOT NULL DEFAULT TRUE,
        installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        uninstalled_at TIMESTAMP NULL,

        scope TEXT NOT NULL,                   -- granted scopes
        app_version VARCHAR(50) NULL,          -- helpful during migrations

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        UNIQUE KEY uniq_shop_domain (shop_domain)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS retailers (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,

        retailer_name VARCHAR(255) NOT NULL,
        retailer_code VARCHAR(100) NULL,
        retailer_type ENUM('online','offline','both') DEFAULT 'offline',

        retailer_city VARCHAR(100) NULL,
        retailer_email VARCHAR(255) NULL,
        retailer_phone VARCHAR(50) NULL,

        is_active TINYINT(1) DEFAULT 1,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        UNIQUE KEY uniq_shop_retailer (shop_id, retailer_name),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS standard_warranty_durations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        months INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        UNIQUE KEY uk_shop_years (shop_id, months),
        CONSTRAINT fk_swd_shop
          FOREIGN KEY (shop_id)
          REFERENCES shops(id)
          ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_standard_warranty_durations (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        shop_id BIGINT UNSIGNED NOT NULL,
        product_id BIGINT NOT NULL,
        duration_months INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_shop_product (shop_id, product_id),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS registered_products (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,

        -- Multi-store support
        shop_id BIGINT UNSIGNED NOT NULL,

        -- Customer
        customer_id VARCHAR(100),
        customer_email VARCHAR(255) NOT NULL,
        customer_name VARCHAR(255),
        customer_locale VARCHAR(16) NULL,

        -- Flow type
        purchase_type ENUM('shopify', 'external') NOT NULL,

        -- Shopify-specific
        shopify_order_id VARCHAR(100),
        shopify_line_item_id VARCHAR(100),
        shopify_product_id VARCHAR(100),
        sku VARCHAR(100),

        -- Common product info
        product_name VARCHAR(255) NOT NULL,
        serial_number VARCHAR(255) NOT NULL,

        -- External-specific
        retailer_name VARCHAR(255),
        purchase_date DATE,

        -- Warranty
        warranty_start DATE NOT NULL,
        warranty_end DATE NOT NULL,
        free_extended_warranty BOOLEAN NOT NULL DEFAULT 0,
        free_extended_warranty_source VARCHAR(50) NULL,
        free_extended_warranty_start DATE NULL,
        free_extended_warranty_end DATE NULL,
        preorder_product BOOLEAN NOT NULL DEFAULT 0,

        -- Consent
        consent_terms BOOLEAN NOT NULL DEFAULT 0,
        consent_marketing BOOLEAN DEFAULT 0,

        -- Metadata
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        UNIQUE KEY uniq_serial_per_store (shop_id, serial_number),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    /* -----------------------------
       STORE SETTINGS TABLE
       (Retailer Required Toggle)
    ------------------------------ */
    await pool.query(`
      CREATE TABLE IF NOT EXISTS store_settings (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,

        retailer_required TINYINT(1) NOT NULL DEFAULT 1,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        UNIQUE KEY uniq_shop (shop_id),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    /* -----------------------------
       EXTENDED WARRANTY DURATIONS
       (Shop-level configurable duration options)
    ------------------------------ */
    await pool.query(`
      CREATE TABLE IF NOT EXISTS extended_warranty_durations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        duration_months INT NOT NULL,
        duration_years INT NOT NULL,
        plan_name VARCHAR(255) NOT NULL,
        merchandising_badge VARCHAR(50) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        UNIQUE KEY uk_shop_ew_duration (shop_id, duration_months),
        CONSTRAINT fk_ewd_shop
          FOREIGN KEY (shop_id)
          REFERENCES shops(id)
          ON DELETE CASCADE
      )
    `);

    /* -----------------------------
       EXTENDED WARRANTY PLANS
       (Per-variant pricing mapped to Shopify products)
    ------------------------------ */
    await pool.query(`
      CREATE TABLE IF NOT EXISTS extended_warranty_plans (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        shopify_product_id BIGINT NOT NULL,
        shopify_variant_id BIGINT NOT NULL,
        plan_name VARCHAR(255) NOT NULL,
        duration_years INT NOT NULL,
        duration_months INT NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'USD',
        status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        UNIQUE KEY uniq_shop_variant_duration (shop_id, shopify_variant_id, duration_months),
        INDEX idx_shop_product (shop_id, shopify_product_id),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    /* -----------------------------
       EXTENDED WARRANTY SETTINGS
       (Per-store configuration: terms, coverage, branding)
    ------------------------------ */
    await pool.query(`
      CREATE TABLE IF NOT EXISTS extended_warranty_settings (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        terms_url VARCHAR(500) NULL,
        coverage_text TEXT NULL,
        extended_warranty_purchase_days INT NULL,
        warranty_pricing_type ENUM('amount', 'percentage') NOT NULL DEFAULT 'amount',
        extended_warranty_offer_enabled TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_ew_settings_shop (shop_id),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    /* -----------------------------
       EXTENDED WARRANTY ENTITLEMENTS
       (Purchase + activation records linked to registrations)
    ------------------------------ */
    await pool.query(`
      CREATE TABLE IF NOT EXISTS extended_warranty_entitlements (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        registered_product_id BIGINT NULL,
        extended_warranty_plan_id BIGINT UNSIGNED NOT NULL,
        shopify_order_id VARCHAR(100) NULL,
        shopify_parent_line_item_id VARCHAR(100) NULL,
        shopify_product_id VARCHAR(100) NULL,
        shopify_variant_id VARCHAR(100) NULL,
        customer_email VARCHAR(255) NULL,
        customer_locale VARCHAR(16) NULL,
        source VARCHAR(50) NULL DEFAULT 'registration',
        status ENUM(
          'active',
          'expired',
          'cancelled',
          'refunded'
        ) NOT NULL DEFAULT 'cancelled',
        plan_name VARCHAR(255) NOT NULL,
        duration_years INT NOT NULL,
        duration_months INT NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        currency VARCHAR(10) NOT NULL,
        pricing_type ENUM('amount', 'percentage') NOT NULL DEFAULT 'amount',
        purchase_date DATE NULL,
        activation_date DATE NULL,
        expiry_date DATE NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ew_ent_shop_register (shop_id, registered_product_id),
        INDEX idx_ew_ent_order (shop_id, shopify_order_id),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
        FOREIGN KEY (registered_product_id) REFERENCES registered_products(id) ON DELETE CASCADE,
        FOREIGN KEY (extended_warranty_plan_id) REFERENCES extended_warranty_plans(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS extended_warranty_refund_settings (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        refund_enabled TINYINT(1) NOT NULL DEFAULT 0,
        pro_rata_enabled TINYINT(1) NOT NULL DEFAULT 0,
        refund_percentage DECIMAL(5, 2) NOT NULL DEFAULT 100.00,
        cancel_on_refund TINYINT(1) NOT NULL DEFAULT 1,
        minimum_used_days INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_ew_refund_shop (shop_id),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS extended_warranty_refund_records (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        entitlement_id BIGINT UNSIGNED NOT NULL,
        shopify_order_id VARCHAR(100) NULL,
        shopify_refund_id VARCHAR(100) NULL,
        original_amount DECIMAL(10, 2) NOT NULL,
        calculated_refund_amount DECIMAL(10, 2) NOT NULL,
        currency VARCHAR(10) NOT NULL,
        total_coverage_days INT NOT NULL,
        remaining_days INT NOT NULL,
        refund_percentage_applied DECIMAL(5, 2) NOT NULL,
        calculation_notes TEXT NULL,
        status ENUM('calculated', 'processed', 'cancelled') NOT NULL DEFAULT 'calculated',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ew_refund_ent (entitlement_id),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
        FOREIGN KEY (entitlement_id) REFERENCES extended_warranty_entitlements(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_settings (
        shop_id BIGINT UNSIGNED PRIMARY KEY,
        global_enabled TINYINT(1) NOT NULL DEFAULT 0,
        store_url VARCHAR(2048) NULL,
        privacy_policy_url VARCHAR(2048) NULL,
        terms_conditions_url VARCHAR(2048) NULL,
        support_url VARCHAR(2048) NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_template_settings (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        template_key VARCHAR(64) NOT NULL,
        language_code VARCHAR(16) NOT NULL DEFAULT 'en',
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        subject VARCHAR(500) NULL,
        body_html MEDIUMTEXT NULL,
        strings_json MEDIUMTEXT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_shop_email_template_lang (shop_id, template_key, language_code),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS shop_email_languages (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        language_code VARCHAR(16) NOT NULL,
        is_default TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_shop_email_language (shop_id, language_code),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS extended_warranty_product_overrides (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        shopify_product_id BIGINT NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        created_by VARCHAR(255) NULL,
        updated_by VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_shop_ew_product_override (shop_id, shopify_product_id),
        INDEX idx_ew_override_shop_enabled (shop_id, enabled),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    await withMigrationLock(ensureSchemaUpdates);
  } catch (err) {
    console.error("❌ DB init failed:", err);
    process.exit(1); // fail fast
  }
}