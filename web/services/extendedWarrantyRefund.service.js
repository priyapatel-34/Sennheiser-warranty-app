import { pool } from "../db/mysql.js";
import { sendEmailService } from "./email.service.js";
import RefundCreatedTemplate from "../emailTemp/extended_warranty_refund_created.js";
import RefundApprovedTemplate from "../emailTemp/extended_warranty_refund_approved.js";
import RefundRejectedTemplate from "../emailTemp/extended_warranty_refund_rejected.js";
import RefundCompletedTemplate from "../emailTemp/extended_warranty_refund_completed.js";

const MS_PER_DAY = 86400000;
const DEFAULT_PAGE_SIZE = 25;

function formatMoney(amount, currency, locale) {
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${currency || ""}`.trim();
  }
}

function formatDateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split("T")[0];
}

function toDateOnly(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * PRD Section 5.2:
 * (days_total - days_used) / days_total × purchase_price - claim_cost
 * Full refund when extended warranty was never activated (days_used = 0, 100%).
 */
export function calculateProRataRefund(entitlement, options = {}) {
  const purchasePrice = Number(entitlement.price);
  const claimCost = Number(options.claimCost || 0);
  const referenceDate = options.referenceDate
    ? toDateOnly(options.referenceDate)
    : toDateOnly(new Date());

  if (!entitlement.activation_date) {
    const daysTotal =
      Number(entitlement.duration_months || 0) * 30 ||
      Math.max(1, daysBetween(entitlement.purchase_date, entitlement.expiry_date));
    const proRataAmount = purchasePrice;
    const netRefundAmount = Math.max(0, proRataAmount - claimCost);

    return {
      refundType: "full",
      purchasePrice,
      usedValue: 0,
      remainingValue: purchasePrice,
      proRataRefundAmount: proRataAmount,
      claimCostDeducted: claimCost,
      netRefundAmount,
      refundAmount: netRefundAmount,
      daysTotal: daysTotal || 1,
      daysUsed: 0,
      remainingDays: daysTotal || 1,
      notes:
        "Scenario 1 — Full refund: extended warranty was not activated (serial not registered).",
      breakdown: {
        formula: "(days_total - days_used) / days_total × purchase_price - claim_cost",
        daysTotal: daysTotal || 1,
        daysUsed: 0,
        purchasePrice,
        claimCostDeducted: claimCost,
        proRataRefundAmount: proRataAmount,
        netRefundAmount,
      },
    };
  }

  const activation = toDateOnly(entitlement.activation_date);
  const expiry = toDateOnly(entitlement.expiry_date);
  const daysTotal = Math.max(1, Math.round((expiry - activation) / MS_PER_DAY));
  const daysUsed = Math.max(
    0,
    Math.min(daysTotal, Math.round((referenceDate - activation) / MS_PER_DAY))
  );
  const remainingDays = Math.max(0, daysTotal - daysUsed);
  const usedValue =
    Math.round((daysUsed / daysTotal) * purchasePrice * 100) / 100;
  const remainingValue =
    Math.round((remainingDays / daysTotal) * purchasePrice * 100) / 100;
  const proRataRefundAmount = remainingValue;
  const netRefundAmount = Math.max(0, proRataRefundAmount - claimCost);

  return {
    refundType: claimCost > 0 ? "net" : "pro_rata",
    purchasePrice,
    usedValue,
    remainingValue,
    proRataRefundAmount,
    claimCostDeducted: claimCost,
    netRefundAmount,
    refundAmount: netRefundAmount,
    daysTotal,
    daysUsed,
    remainingDays,
    notes: `Scenario 2 — Pro-rata: (${daysTotal} - ${daysUsed}) / ${daysTotal} × ${purchasePrice}${
      claimCost > 0 ? ` - ${claimCost} claim cost` : ""
    }`,
    breakdown: {
      formula: "(days_total - days_used) / days_total × purchase_price - claim_cost",
      daysTotal,
      daysUsed,
      remainingDays,
      purchasePrice,
      usedValue,
      remainingValue,
      claimCostDeducted: claimCost,
      proRataRefundAmount,
      netRefundAmount,
    },
  };
}

function daysBetween(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((toDateOnly(end) - toDateOnly(start)) / MS_PER_DAY));
}

export async function getRefundSettings(shopId) {
  const [[row]] = await pool.query(
    `
    SELECT *
    FROM extended_warranty_refund_settings
    WHERE shop_id = ?
    LIMIT 1
    `,
    [shopId]
  );

  if (!row) {
    return {
      refund_enabled: 1,
      pro_rata_enabled: 1,
      cancel_on_refund: 1,
      refund_percentage: 100,
      minimum_used_days: 0,
      eligibility_window_days: null,
      auto_cancel_entitlement: 1,
      finance_notification_emails: null,
    };
  }

  return row;
}

export async function saveRefundSettings(shopId, settings) {
  const {
    refundEnabled = true,
    proRataEnabled = true,
    refundPercentage = 100,
    cancelOnRefund = true,
    minimumUsedDays = 0,
    eligibilityWindowDays = null,
    autoCancelEntitlement = true,
    financeNotificationEmails = "",
  } = settings;

  await pool.query(
    `
    INSERT INTO extended_warranty_refund_settings (
      shop_id,
      refund_enabled,
      pro_rata_enabled,
      refund_percentage,
      cancel_on_refund,
      minimum_used_days,
      eligibility_window_days,
      auto_cancel_entitlement,
      finance_notification_emails
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      refund_enabled = VALUES(refund_enabled),
      pro_rata_enabled = VALUES(pro_rata_enabled),
      refund_percentage = VALUES(refund_percentage),
      cancel_on_refund = VALUES(cancel_on_refund),
      minimum_used_days = VALUES(minimum_used_days),
      eligibility_window_days = VALUES(eligibility_window_days),
      auto_cancel_entitlement = VALUES(auto_cancel_entitlement),
      finance_notification_emails = VALUES(finance_notification_emails),
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      shopId,
      refundEnabled ? 1 : 0,
      proRataEnabled ? 1 : 0,
      Number(refundPercentage),
      cancelOnRefund ? 1 : 0,
      Number(minimumUsedDays) || 0,
      eligibilityWindowDays ? Number(eligibilityWindowDays) : null,
      autoCancelEntitlement ? 1 : 0,
      financeNotificationEmails?.trim() || null,
    ]
  );
}

async function logRefundAudit(refundRecordId, shopId, action, actor, details = null) {
  await pool.query(
    `
    INSERT INTO extended_warranty_refund_audit (
      refund_record_id,
      shop_id,
      action,
      actor,
      details
    ) VALUES (?, ?, ?, ?, ?)
    `,
    [
      refundRecordId,
      shopId,
      action,
      actor || null,
      details ? JSON.stringify(details) : null,
    ]
  );
}

async function loadEntitlementWithRegistration(shopId, entitlementId) {
  const [[row]] = await pool.query(
    `
    SELECT
      e.*,
      r.customer_email,
      r.customer_name,
      r.product_name,
      r.serial_number,
      r.sku,
      r.warranty_end
    FROM extended_warranty_entitlements e
    LEFT JOIN registered_products r
      ON r.id = e.registered_product_id AND r.shop_id = e.shop_id
    WHERE e.shop_id = ? AND e.id = ?
    LIMIT 1
    `,
    [shopId, entitlementId]
  );
  return row || null;
}

async function notifyFinanceTeam(settings, subject, html) {
  const emails = String(settings.finance_notification_emails || "")
    .split(/[,;]/)
    .map(e => e.trim())
    .filter(Boolean);

  for (const to of emails) {
    await sendEmailService({ to, subject, html, from: process.env.DEFAULT_FROM_EMAIL });
  }
}

async function sendRefundCustomerEmail(type, record, entitlement, storeName = "Sennheiser") {
  const customerEmail = record.customer_email || entitlement.customer_email;
  if (!customerEmail) return;

  const customerName = record.customer_name || entitlement.customer_name || "Customer";
  const productTitle = record.product_name || entitlement.product_name || "Product";
  const planName = record.warranty_plan || entitlement.plan_name;
  const formattedAmount = formatMoney(record.net_refund_amount, record.currency);

  const templates = {
    created: {
      subject: "Extended Warranty Refund Request Received",
      html: RefundCreatedTemplate({
        customerName,
        productTitle,
        serialNumber: record.serial_number || entitlement.serial_number,
        planName,
        refundAmount: formattedAmount,
        currency: record.currency,
        storeName,
      }),
    },
    approved: {
      subject: "Extended Warranty Refund Approved",
      html: RefundApprovedTemplate({
        customerName,
        productTitle,
        planName,
        refundAmount: formattedAmount,
        currency: record.currency,
        storeName,
      }),
    },
    rejected: {
      subject: "Extended Warranty Refund Request Update",
      html: RefundRejectedTemplate({
        customerName,
        productTitle,
        planName,
        rejectionReason: record.rejection_reason,
        storeName,
      }),
    },
    completed: {
      subject: "Extended Warranty Refund Processed",
      html: RefundCompletedTemplate({
        customerName,
        productTitle,
        planName,
        refundAmount: formattedAmount,
        currency: record.currency,
        storeName,
      }),
    },
  };

  const template = templates[type];
  if (!template) return;

  await sendEmailService({
    to: customerEmail,
    subject: template.subject,
    html: template.html,
    from: process.env.DEFAULT_FROM_EMAIL,
  });
}

function mapRefundRow(row) {
  return {
    id: row.id,
    entitlementId: row.entitlement_id,
    shopifyOrderId: row.shopify_order_id,
    shopifyRefundId: row.shopify_refund_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    productName: row.product_name,
    serialNumber: row.serial_number,
    productSku: row.product_sku,
    warrantyPlan: row.warranty_plan,
    purchasePrice: Number(row.purchase_price ?? row.original_amount),
    purchaseDate: formatDateOnly(row.purchase_date),
    cancellationDate: formatDateOnly(row.cancellation_date),
    coverageStartDate: formatDateOnly(row.coverage_start_date),
    coverageEndDate: formatDateOnly(row.coverage_end_date),
    daysTotal: row.days_total ?? row.total_coverage_days,
    daysUsed: row.days_used,
    remainingDays: row.remaining_days,
    usedValue: row.used_value != null ? Number(row.used_value) : null,
    remainingValue:
      row.remaining_value != null ? Number(row.remaining_value) : null,
    proRataRefundAmount: Number(
      row.pro_rata_refund_amount ?? row.calculated_refund_amount
    ),
    claimCostDeducted: Number(row.claim_cost_deducted || 0),
    netRefundAmount: Number(row.net_refund_amount ?? row.calculated_refund_amount),
    currency: row.currency,
    refundType: row.refund_type,
    refundTrigger: row.refund_trigger,
    refundReason: row.refund_reason,
    status: normalizeRefundStatus(row.status),
    adminNotes: row.admin_notes,
    rejectionReason: row.rejection_reason,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    rejectedAt: row.rejected_at,
    rejectedBy: row.rejected_by,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    calculationNotes: row.calculation_notes,
    calculationBreakdown: row.calculation_breakdown
      ? typeof row.calculation_breakdown === "string"
        ? JSON.parse(row.calculation_breakdown)
        : row.calculation_breakdown
      : null,
    createdAt: row.created_at,
  };
}

function normalizeRefundStatus(status) {
  if (status === "calculated" || status === "pending_finance_action") {
    return "pending_review";
  }
  if (status === "processed") return "refunded";
  return status;
}

export async function createRefundRequest({
  shopId,
  entitlement,
  trigger = "product_return",
  reason = null,
  shopifyOrderId = null,
  shopifyRefundId = null,
  claimCost = 0,
  actor = "system",
  storeName = "Sennheiser",
}) {
  const settings = await getRefundSettings(shopId);
  if (!settings.refund_enabled) {
    return null;
  }

  const calculation = calculateProRataRefund(entitlement, { claimCost });
  const wasActivated = Boolean(entitlement.activation_date);
  const cancellationDate = formatDateOnly(new Date());

  const [insertResult] = await pool.query(
    `
    INSERT INTO extended_warranty_refund_records (
      shop_id,
      entitlement_id,
      shopify_order_id,
      shopify_refund_id,
      customer_email,
      customer_name,
      product_name,
      product_sku,
      serial_number,
      warranty_plan,
      purchase_price,
      original_amount,
      purchase_date,
      cancellation_date,
      coverage_start_date,
      coverage_end_date,
      days_total,
      total_coverage_days,
      days_used,
      remaining_days,
      used_value,
      remaining_value,
      pro_rata_refund_amount,
      calculated_refund_amount,
      claim_cost_deducted,
      net_refund_amount,
      currency,
      refund_type,
      refund_trigger,
      refund_reason,
      refund_percentage_applied,
      calculation_notes,
      calculation_breakdown,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review')
    `,
    [
      shopId,
      entitlement.id,
      shopifyOrderId || entitlement.shopify_order_id,
      shopifyRefundId,
      entitlement.customer_email,
      entitlement.customer_name,
      entitlement.product_name,
      entitlement.sku,
      entitlement.serial_number,
      `${entitlement.plan_name} (${entitlement.duration_months} months)`,
      calculation.purchasePrice,
      calculation.purchasePrice,
      formatDateOnly(entitlement.purchase_date),
      cancellationDate,
      formatDateOnly(entitlement.activation_date),
      formatDateOnly(entitlement.expiry_date),
      calculation.daysTotal,
      calculation.daysTotal,
      calculation.daysUsed,
      calculation.remainingDays,
      calculation.usedValue,
      calculation.remainingValue,
      calculation.proRataRefundAmount,
      calculation.netRefundAmount,
      calculation.claimCostDeducted,
      calculation.netRefundAmount,
      entitlement.currency,
      calculation.refundType,
      trigger,
      reason ||
        (wasActivated
          ? "Product returned — extended warranty was activated (pro-rata refund)"
          : "Product returned — extended warranty not activated (full refund)"),
      100,
      calculation.notes,
      JSON.stringify(calculation.breakdown),
    ]
  );

  const refundId = insertResult.insertId;

  if (settings.auto_cancel_entitlement ?? settings.cancel_on_refund) {
    const newStatus = wasActivated ? "refunded" : "cancelled";
    await pool.query(
      `
      UPDATE extended_warranty_entitlements
      SET
        status = ?,
        refund_amount = ?,
        refunded_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [newStatus, calculation.netRefundAmount, entitlement.id]
    );
  }

  await logRefundAudit(refundId, shopId, "created", actor, {
    trigger,
    calculation,
  });

  const [[record]] = await pool.query(
    `SELECT * FROM extended_warranty_refund_records WHERE id = ?`,
    [refundId]
  );

  await sendRefundCustomerEmail("created", record, entitlement, storeName);

  const financeSubject = `New EW refund request #${refundId} — ${formatMoney(calculation.netRefundAmount, entitlement.currency)}`;
  const financeHtml = `<p>A new extended warranty refund request requires finance review.</p>
    <p><strong>Request ID:</strong> ${refundId}<br/>
    <strong>Customer:</strong> ${entitlement.customer_email}<br/>
    <strong>Amount:</strong> ${formatMoney(calculation.netRefundAmount, entitlement.currency)}</p>`;
  await notifyFinanceTeam(settings, financeSubject, financeHtml);

  return { refundId, calculation, record: mapRefundRow(record) };
}

export async function cancelEntitlementFromRefund({
  shopId,
  shopifyOrderId,
  shopifyRefundId = null,
  trigger = "product_return",
}) {
  const [entitlements] = await pool.query(
    `
    SELECT
      e.*,
      r.customer_email,
      r.customer_name,
      r.product_name,
      r.serial_number,
      r.sku,
      r.warranty_end
    FROM extended_warranty_entitlements e
    LEFT JOIN registered_products r
      ON r.id = e.registered_product_id AND r.shop_id = e.shop_id
    WHERE e.shop_id = ?
      AND e.shopify_order_id = ?
      AND e.status IN ('active', 'pending_payment')
    `,
    [shopId, shopifyOrderId]
  );

  const results = [];

  for (const entitlement of entitlements) {
    const existing = await pool.query(
      `
      SELECT id FROM extended_warranty_refund_records
      WHERE entitlement_id = ? AND status NOT IN ('cancelled', 'rejected')
      LIMIT 1
      `,
      [entitlement.id]
    );

    if (existing[0]?.length) {
      results.push({ entitlementId: entitlement.id, skipped: true });
      continue;
    }

    const created = await createRefundRequest({
      shopId,
      entitlement,
      trigger,
      shopifyOrderId,
      shopifyRefundId,
    });

    if (created) {
      results.push({ entitlementId: entitlement.id, ...created });
    }
  }

  return results;
}

export async function createManualRefundRequest({
  shopId,
  entitlementId,
  trigger = "manual_admin",
  reason = "Manual refund initiated by admin",
  claimCost = 0,
  actor = "admin",
}) {
  const entitlement = await loadEntitlementWithRegistration(shopId, entitlementId);
  if (!entitlement) {
    throw new Error("Entitlement not found");
  }

  if (!["active", "pending_payment"].includes(entitlement.status)) {
    throw new Error("Entitlement is not eligible for refund");
  }

  return createRefundRequest({
    shopId,
    entitlement,
    trigger,
    reason,
    claimCost,
    actor,
  });
}

export async function listRefundRequests(shopId, options = {}) {
  const page = Math.max(1, parseInt(options.page, 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(options.limit, 10) || DEFAULT_PAGE_SIZE)
  );
  const offset = (page - 1) * pageSize;
  const status = options.status?.trim();
  const search = options.q?.trim();

  const conditions = ["rr.shop_id = ?"];
  const params = [shopId];

  if (status && status !== "all") {
    if (status === "pending_review") {
      conditions.push("rr.status IN ('pending_review', 'calculated', 'pending_finance_action')");
    } else if (status === "refunded") {
      conditions.push("rr.status IN ('refunded', 'processed')");
    } else {
      conditions.push("rr.status = ?");
      params.push(status);
    }
  }

  if (search) {
    conditions.push(`(
      rr.customer_email LIKE ?
      OR rr.customer_name LIKE ?
      OR rr.product_name LIKE ?
      OR rr.serial_number LIKE ?
      OR rr.product_sku LIKE ?
      OR CAST(rr.id AS CHAR) LIKE ?
    )`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like);
  }

  const where = conditions.join(" AND ");

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM extended_warranty_refund_records rr WHERE ${where}`,
    params
  );
  const total = countRow?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const [rows] = await pool.query(
    `
    SELECT rr.*
    FROM extended_warranty_refund_records rr
    WHERE ${where}
    ORDER BY rr.created_at DESC
    LIMIT ? OFFSET ?
    `,
    [...params, pageSize, offset]
  );

  return {
    data: rows.map(mapRefundRow),
    pagination: {
      total,
      totalPages,
      page,
      pageSize,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}

export async function getRefundRequestDetail(shopId, refundId) {
  const [[row]] = await pool.query(
    `
    SELECT rr.*
    FROM extended_warranty_refund_records rr
    WHERE rr.shop_id = ? AND rr.id = ?
    LIMIT 1
    `,
    [shopId, refundId]
  );

  if (!row) return null;

  const [auditRows] = await pool.query(
    `
    SELECT action, actor, details, created_at
    FROM extended_warranty_refund_audit
    WHERE refund_record_id = ?
    ORDER BY created_at ASC
    `,
    [refundId]
  );

  return {
    ...mapRefundRow(row),
    auditTrail: auditRows.map(a => ({
      action: a.action,
      actor: a.actor,
      details: a.details
        ? typeof a.details === "string"
          ? JSON.parse(a.details)
          : a.details
        : null,
      createdAt: a.created_at,
    })),
  };
}

async function updateRefundStatus({
  shopId,
  refundId,
  status,
  actor,
  extra = {},
}) {
  const detail = await getRefundRequestDetail(shopId, refundId);
  if (!detail) throw new Error("Refund request not found");

  const fields = ["status = ?", "updated_at = CURRENT_TIMESTAMP"];
  const params = [status];

  const columnMap = {
    approved_at: extra.approvedAt,
    approved_by: extra.approvedBy,
    rejected_at: extra.rejectedAt,
    rejected_by: extra.rejectedBy,
    rejection_reason: extra.rejectionReason,
    completed_at: extra.completedAt,
    completed_by: extra.completedBy,
    admin_notes: extra.adminNotes,
  };

  for (const [col, val] of Object.entries(columnMap)) {
    if (val !== undefined) {
      fields.push(`${col} = ?`);
      params.push(val);
    }
  }

  params.push(refundId, shopId);

  await pool.query(
    `
    UPDATE extended_warranty_refund_records
    SET ${fields.join(", ")}
    WHERE id = ? AND shop_id = ?
    `,
    params
  );

  await logRefundAudit(refundId, shopId, status, actor, extra.auditDetails || null);

  const entitlement = await loadEntitlementWithRegistration(
    shopId,
    detail.entitlementId
  );
  const [[record]] = await pool.query(
    `SELECT * FROM extended_warranty_refund_records WHERE id = ?`,
    [refundId]
  );

  return { detail, entitlement, record };
}

export async function approveRefundRequest(shopId, refundId, actor, adminNotes) {
  const current = await getRefundRequestDetail(shopId, refundId);
  if (!current) throw new Error("Refund request not found");
  if (!["pending_review", "calculated", "pending_finance_action"].includes(current.status)) {
    throw new Error("Refund request cannot be approved in its current status");
  }

  const { entitlement, record } = await updateRefundStatus({
    shopId,
    refundId,
    status: "approved",
    actor,
    extra: {
      approvedAt: new Date(),
      approvedBy: actor,
      adminNotes,
      auditDetails: { adminNotes },
    },
  });

  await sendRefundCustomerEmail("approved", record, entitlement);
  return mapRefundRow(record);
}

export async function rejectRefundRequest(shopId, refundId, actor, rejectionReason) {
  const current = await getRefundRequestDetail(shopId, refundId);
  if (!current) throw new Error("Refund request not found");
  if (!["pending_review", "calculated", "pending_finance_action"].includes(current.status)) {
    throw new Error("Refund request cannot be rejected in its current status");
  }

  const { entitlement, record } = await updateRefundStatus({
    shopId,
    refundId,
    status: "rejected",
    actor,
    extra: {
      rejectedAt: new Date(),
      rejectedBy: actor,
      rejectionReason,
      auditDetails: { rejectionReason },
    },
  });

  await sendRefundCustomerEmail("rejected", record, entitlement);
  return mapRefundRow(record);
}

export async function completeRefundRequest(shopId, refundId, actor, adminNotes) {
  const current = await getRefundRequestDetail(shopId, refundId);
  if (!current) throw new Error("Refund request not found");
  if (current.status !== "approved") {
    throw new Error("Only approved refund requests can be marked as refunded");
  }

  const { entitlement, record } = await updateRefundStatus({
    shopId,
    refundId,
    status: "refunded",
    actor,
    extra: {
      completedAt: new Date(),
      completedBy: actor,
      adminNotes: adminNotes || current.adminNotes,
      auditDetails: { adminNotes },
    },
  });

  await sendRefundCustomerEmail("completed", record, entitlement);
  return mapRefundRow(record);
}

export async function cancelRefundRequest(shopId, refundId, actor, reason) {
  const current = await getRefundRequestDetail(shopId, refundId);
  if (!current) throw new Error("Refund request not found");
  if (["refunded", "cancelled"].includes(current.status)) {
    throw new Error("Refund request cannot be cancelled");
  }

  const { record } = await updateRefundStatus({
    shopId,
    refundId,
    status: "cancelled",
    actor,
    extra: {
      rejectionReason: reason,
      auditDetails: { reason },
    },
  });

  return mapRefundRow(record);
}

export async function getLatestRefundForEntitlements(shopId, entitlementIds) {
  if (!entitlementIds.length) return new Map();

  const placeholders = entitlementIds.map(() => "?").join(",");
  const [rows] = await pool.query(
    `
    SELECT rr.*
    FROM extended_warranty_refund_records rr
    INNER JOIN (
      SELECT entitlement_id, MAX(id) AS max_id
      FROM extended_warranty_refund_records
      WHERE shop_id = ?
        AND entitlement_id IN (${placeholders})
      GROUP BY entitlement_id
    ) latest ON latest.max_id = rr.id
    `,
    [shopId, ...entitlementIds]
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.entitlement_id, mapRefundRow(row));
  }
  return map;
}

export async function exportRefundRequestsCsv(shopId, options = {}) {
  const result = await listRefundRequests(shopId, {
    ...options,
    page: 1,
    limit: 10000,
  });

  const headers = [
    "Request ID",
    "Customer Name",
    "Customer Email",
    "Product",
    "Serial Number",
    "SKU",
    "Warranty Plan",
    "Purchase Date",
    "Coverage Start",
    "Coverage End",
    "Refund Reason",
    "Original Amount",
    "Used Value",
    "Remaining Value",
    "Net Refund Amount",
    "Currency",
    "Status",
    "Created At",
  ];

  const escapeCsv = value => {
    const str = value == null ? "" : String(value);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const lines = [headers.join(",")];
  for (const row of result.data) {
    lines.push(
      [
        row.id,
        row.customerName,
        row.customerEmail,
        row.productName,
        row.serialNumber,
        row.productSku,
        row.warrantyPlan,
        row.purchaseDate,
        row.coverageStartDate,
        row.coverageEndDate,
        row.refundReason,
        row.purchasePrice,
        row.usedValue,
        row.remainingValue,
        row.netRefundAmount,
        row.currency,
        row.status,
        row.createdAt,
      ]
        .map(escapeCsv)
        .join(",")
    );
  }

  return lines.join("\n");
}

export function getCustomerFacingRefundStatus(entitlement, refundRecord) {
  if (!entitlement) return null;

  if (refundRecord) {
    switch (refundRecord.status) {
      case "pending_review":
        return "Refund Pending";
      case "approved":
        return "Refund Approved";
      case "refunded":
        return refundRecord.refundType === "full" ? "Refunded" : "Refunded";
      case "rejected":
        return "Warranty Terminated";
      case "cancelled":
        return "Cancelled";
      case "disputed":
        return "Disputed";
      default:
        break;
    }
  }

  if (entitlement.status === "refunded") return "Refunded";
  if (entitlement.status === "cancelled") return "Cancelled";
  return null;
}
