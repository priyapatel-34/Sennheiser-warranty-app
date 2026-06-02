import { pool } from "./mysql.js";

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

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        UNIQUE KEY uniq_shop (shop_id),
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    console.log("✅ Store settings table ready");
    
  } catch (err) {
    console.error("❌ DB init failed:", err);
    process.exit(1); // fail fast
  }
}
