import { pool } from "./mysql.js";

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `
    SELECT COUNT(*) AS cnt
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    `,
    [table, column]
  );
  return rows[0].cnt > 0;
}

async function indexExists(table, indexName) {
  const [[row]] = await pool.query(
    `
    SELECT COUNT(*) AS cnt
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND INDEX_NAME = ?
    `,
    [table, indexName]
  );
  return row.cnt > 0;
}

/** Additive schema updates for existing installs (no migration framework). */
async function ensureSchemaUpdates() {
  if (!(await columnExists("registered_products", "shopify_variant_id"))) {
    await pool.query(`
      ALTER TABLE registered_products
      ADD COLUMN shopify_variant_id VARCHAR(100) NULL AFTER shopify_product_id
    `);
    console.log("✅ Added registered_products.shopify_variant_id");
  }

  const planColumns = [
    ["coverage_text", "TEXT NULL AFTER status"],
    [
      "shopify_checkout_variant_id",
      "BIGINT NULL AFTER coverage_text",
    ],
  ];

  for (const [col, definition] of planColumns) {
    if (!(await columnExists("extended_warranty_plans", col))) {
      await pool.query(
        `ALTER TABLE extended_warranty_plans ADD COLUMN ${col} ${definition}`
      );
      console.log(`✅ Added extended_warranty_plans.${col}`);
    }
  }

  const entitlementColumns = [
    ["refund_amount", "DECIMAL(10, 2) NULL AFTER expiry_date"],
    ["refunded_at", "TIMESTAMP NULL AFTER refund_amount"],
  ];

  for (const [col, definition] of entitlementColumns) {
    if (!(await columnExists("extended_warranty_entitlements", col))) {
      await pool.query(
        `ALTER TABLE extended_warranty_entitlements ADD COLUMN ${col} ${definition}`
      );
      console.log(`✅ Added extended_warranty_entitlements.${col}`);
    }
  }

  const searchIndexes = [
    ["registered_products", "idx_rp_shop_customer_email", "shop_id, customer_email"],
    ["registered_products", "idx_rp_shop_serial", "shop_id, serial_number"],
    ["registered_products", "idx_rp_shop_product_name", "shop_id, product_name"],
    ["registered_products", "idx_rp_shop_created", "shop_id, created_at"],
    ["registered_products", "idx_rp_shop_purchase_type", "shop_id, purchase_type"],
  ];

  for (const [table, indexName, columns] of searchIndexes) {
    const [[exists]] = await pool.query(
      `
      SELECT COUNT(*) AS cnt
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
      `,
      [table, indexName]
    );
    if (!exists.cnt) {
      await pool.query(`CREATE INDEX ${indexName} ON ${table} (${columns})`);
    }
  }

  if (!(await indexExists("registered_products", "uniq_shop_line_item"))) {
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
    console.log("✅ Added registered_products.uniq_shop_line_item");
  }

  const refundRecordColumns = [
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
  ];

  for (const [col, definition] of refundRecordColumns) {
    if (!(await columnExists("extended_warranty_refund_records", col))) {
      await pool.query(
        `ALTER TABLE extended_warranty_refund_records ADD COLUMN ${col} ${definition}`
      );
      console.log(`✅ Added extended_warranty_refund_records.${col}`);
    }
  }

  const refundSettingsColumns = [
    ["eligibility_window_days", "INT NULL AFTER minimum_used_days"],
    ["auto_cancel_entitlement", "TINYINT(1) NOT NULL DEFAULT 1 AFTER cancel_on_refund"],
    [
      "finance_notification_emails",
      "TEXT NULL AFTER auto_cancel_entitlement",
    ],
  ];

  for (const [col, definition] of refundSettingsColumns) {
    if (!(await columnExists("extended_warranty_refund_settings", col))) {
      await pool.query(
        `ALTER TABLE extended_warranty_refund_settings ADD COLUMN ${col} ${definition}`
      );
      console.log(`✅ Added extended_warranty_refund_settings.${col}`);
    }
  }

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
  } catch (err) {
    console.warn("⚠️ Refund status enum update skipped:", err.message);
  }

  const refundIndexes = [
    ["extended_warranty_refund_records", "idx_ew_refund_shop_status", "shop_id, status"],
    ["extended_warranty_refund_records", "idx_ew_refund_created", "shop_id, created_at"],
  ];

  for (const [table, indexName, columns] of refundIndexes) {
    const [[exists]] = await pool.query(
      `
      SELECT COUNT(*) AS cnt
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
      `,
      [table, indexName]
    );
    if (!exists.cnt) {
      await pool.query(`CREATE INDEX ${indexName} ON ${table} (${columns})`);
    }
  }

  // if (await columnExists("email_template_settings", "content_sections")) {
  //   await pool.query(`
  //     ALTER TABLE email_template_settings DROP COLUMN content_sections
  //   `);
  //   console.log("✅ Removed email_template_settings.content_sections");
  // }

  // try {
  //   await pool.query(`DROP TABLE IF EXISTS email_branding_settings`);
  //   console.log("✅ Removed email_branding_settings table (if existed)");
  // } catch (err) {
  //   console.warn("⚠️ email_branding_settings drop skipped:", err.message);
  // }

  // if (await columnExists("extended_warranty_settings", "reminder_coverage_benefits")) {
  //   await pool.query(`
  //     ALTER TABLE extended_warranty_settings
  //     DROP COLUMN reminder_coverage_benefits
  //   `);
  //   console.log("✅ Removed extended_warranty_settings.reminder_coverage_benefits");
  // }

  if (!(await columnExists("extended_warranty_durations", "merchandising_badge"))) {
    await pool.query(`
      ALTER TABLE extended_warranty_durations
      ADD COLUMN merchandising_badge VARCHAR(50) NULL AFTER plan_name
    `);
    console.log("✅ Added extended_warranty_durations.merchandising_badge");
  }

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
  ];

  for (const [col, definition] of ewSettingsColumns) {
    if (!(await columnExists("extended_warranty_settings", col))) {
      if (
        col === "extended_warranty_purchase_days" &&
        (await columnExists("extended_warranty_settings", "default_purchase_window_days"))
      ) {
        await pool.query(`
          ALTER TABLE extended_warranty_settings
          CHANGE COLUMN default_purchase_window_days extended_warranty_purchase_days INT NULL
        `);
        console.log("✅ Renamed default_purchase_window_days to extended_warranty_purchase_days");
      } else {
        await pool.query(
          `ALTER TABLE extended_warranty_settings ADD COLUMN ${col} ${definition}`
        );
        console.log(`✅ Added extended_warranty_settings.${col}`);
      }
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
    if (await columnExists("extended_warranty_settings", col)) {
      await pool.query(
        `ALTER TABLE extended_warranty_settings DROP COLUMN ${col}`
      );
      console.log(`✅ Removed extended_warranty_settings.${col}`);
    }
  }

  if (await columnExists("extended_warranty_plans", "region_code")) {
    await pool.query(`ALTER TABLE extended_warranty_plans DROP COLUMN region_code`);
    console.log("✅ Removed extended_warranty_plans.region_code");
  }

  try {
    await pool.query(`DROP TABLE IF EXISTS extended_warranty_purchase_windows`);
    console.log("✅ Removed extended_warranty_purchase_windows table (if existed)");
  } catch (err) {
    console.warn("⚠️ Purchase windows table drop skipped:", err.message);
  }

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
  console.log("✅ Extended warranty eligibility reminders table ready");

  if (
    await columnExists("extended_warranty_eligibility_reminders", "reminder_days")
  ) {
    try {
      await pool.query(`
        ALTER TABLE extended_warranty_eligibility_reminders
        MODIFY reminder_days INT UNSIGNED NOT NULL
      `);
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
  console.log("✅ Extended warranty expiry reminder configs table ready");

  if (!(await columnExists("registered_products", "country_code"))) {
    await pool.query(`
      ALTER TABLE registered_products
      ADD COLUMN country_code VARCHAR(10) NULL AFTER purchase_type
    `);
    console.log("✅ Added registered_products.country_code");
  }

  if (
    !(await columnExists(
      "registered_products",
      "extended_warranty_offer_enabled_at_registration"
    ))
  ) {
    await pool.query(`
      ALTER TABLE registered_products
      ADD COLUMN extended_warranty_offer_enabled_at_registration TINYINT(1) NULL
      AFTER consent_marketing
    `);
    console.log(
      "✅ Added registered_products.extended_warranty_offer_enabled_at_registration"
    );
  }

  if (!(await columnExists("extended_warranty_entitlements", "pricing_type"))) {
    await pool.query(`
      ALTER TABLE extended_warranty_entitlements
      ADD COLUMN pricing_type ENUM('amount', 'percentage') NOT NULL DEFAULT 'amount' AFTER currency
    `);
    console.log("✅ Added extended_warranty_entitlements.pricing_type");
  }

  if (!(await columnExists("retailers", "retailer_name_ja"))) {
    await pool.query(`
      ALTER TABLE retailers
      ADD COLUMN retailer_name_ja VARCHAR(255) NULL AFTER retailer_name
    `);
    console.log("✅ Added retailers.retailer_name_ja");
  }

  /* -----------------------------
     STORE-SPECIFIC SERIAL NUMBER VERIFICATION
     (additive for existing installs; default OFF so existing
     stores keep their current registration behaviour unchanged)
  ------------------------------ */
  if (!(await columnExists("store_settings", "serial_verification_enabled"))) {
    await pool.query(`
      ALTER TABLE store_settings
      ADD COLUMN serial_verification_enabled TINYINT(1) NOT NULL DEFAULT 0
      AFTER retailer_required
    `);
    console.log("✅ Added store_settings.serial_verification_enabled");
  }
}

export async function initDb() {
  try {
    console.log("🔧 Initializing database...");

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

    console.log("✅ Retailers table ready");

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

    console.log("✅ standard warranty durations table ready");

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

        -- Store-specific serial number verification toggle.
        -- Defaults to OFF so existing stores keep registering exactly as
        -- they do today. Only stores that explicitly enable this use the
        -- imported_serial_numbers allow-list during registration.
        serial_verification_enabled TINYINT(1) NOT NULL DEFAULT 0,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        UNIQUE KEY uniq_shop (shop_id),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    console.log("✅ Store settings table ready");

    /* -----------------------------
       IMPORTED SERIAL NUMBERS
       (Per-shop allow-list used only when
       store_settings.serial_verification_enabled = 1)
    ------------------------------ */
    await pool.query(`
      CREATE TABLE IF NOT EXISTS imported_serial_numbers (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,

        -- Normalized (trimmed + uppercased) so lookups during
        -- registration are a single indexed equality match.
        serial_number VARCHAR(255) NOT NULL,

        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        -- Same serial number can exist independently for different shops,
        -- but never twice for the same shop.
        UNIQUE KEY uniq_shop_serial (shop_id, serial_number),
        INDEX idx_shop_created (shop_id, created_at),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    console.log("✅ Imported serial numbers table ready");

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

    console.log("✅ Extended warranty durations table ready");

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

    console.log("✅ Extended warranty plans table ready");

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
        extended_warranty_offer_enabled TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_ew_settings_shop (shop_id),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    console.log("✅ Extended warranty settings table ready");

    /* -----------------------------
       EXTENDED WARRANTY ENTITLEMENTS
       (Purchase + activation records linked to registrations)
    ------------------------------ */
    await pool.query(`
      CREATE TABLE IF NOT EXISTS extended_warranty_entitlements (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        registered_product_id BIGINT NOT NULL,
        extended_warranty_plan_id BIGINT UNSIGNED NOT NULL,
        shopify_order_id VARCHAR(100) NULL,
        shopify_draft_order_id VARCHAR(100) NULL,
        status ENUM(
          'pending_payment',
          'active',
          'expired',
          'cancelled',
          'refunded'
        ) NOT NULL DEFAULT 'pending_payment',
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

    console.log("✅ Extended warranty entitlements table ready");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS extended_warranty_refund_settings (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        refund_enabled TINYINT(1) NOT NULL DEFAULT 1,
        pro_rata_enabled TINYINT(1) NOT NULL DEFAULT 1,
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

    console.log("✅ Extended warranty refund settings table ready");

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

    console.log("✅ Extended warranty refund records table ready");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_settings (
        shop_id BIGINT UNSIGNED PRIMARY KEY,
        global_enabled TINYINT(1) NOT NULL DEFAULT 1,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_template_settings (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        shop_id BIGINT UNSIGNED NOT NULL,
        template_key VARCHAR(64) NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        subject VARCHAR(500) NULL,
        body_html MEDIUMTEXT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_shop_email_template (shop_id, template_key),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    console.log("✅ Email settings tables ready");

    await ensureSchemaUpdates();

  } catch (err) {
    console.error("❌ DB init failed:", err);
    process.exit(1); // fail fast
  }
}
