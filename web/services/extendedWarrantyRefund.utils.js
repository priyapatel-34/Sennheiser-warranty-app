const MS_PER_DAY = 86400000;

export const REFUND_STATUS = {
  PENDING_FINANCE: "pending_finance_action",
  REIMBURSED: "reimbursed",
  DISPUTED: "disputed",
  CANCELLED: "cancelled",
  MANUAL_REVIEW: "manual_review",
};

export const ENTITLEMENT_CANCEL_STATUSES = {
  FULL: "cancelled_full_refund",
  PRO_RATA: "cancelled_pro_rata",
  NET: "cancelled_net",
  MANUAL_REVIEW: "manual_review",
};

const TERMINAL_REFUND_STATUSES = new Set([
  REFUND_STATUS.REIMBURSED,
  REFUND_STATUS.CANCELLED,
  "refunded",
  "processed",
]);

const ACTIVE_ENTITLEMENT_STATUSES = new Set([
  "active",
  "pending_payment",
  "manual_review",
]);

export function normalizeShopifyId(value) {
  if (value == null || value === "") return null;
  const str = String(value).trim();
  const last = str.includes("/") ? str.split("/").pop() : str;
  const digits = last.replace(/\D/g, "");
  return digits || last;
}

export function normalizeLineItemId(value) {
  return normalizeShopifyId(value);
}

function toDateOnly(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysBetween(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((toDateOnly(end) - toDateOnly(start)) / MS_PER_DAY));
}

/**
 * PRD Section 5.2:
 * (days_total - days_used) / days_total × purchase_price - claim_cost
 * Full refund when extended warranty was never activated (days_used = 0 → 100%).
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
        "Full refund: extended warranty was not activated (serial not registered).",
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
  const usedValue = Math.round((daysUsed / daysTotal) * purchasePrice * 100) / 100;
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
    notes: `Pro-rata: (${daysTotal} - ${daysUsed}) / ${daysTotal} × ${purchasePrice}${
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

export function deriveEntitlementCancelStatus(calculation) {
  if (calculation.refundType === "full") return ENTITLEMENT_CANCEL_STATUSES.FULL;
  if (calculation.refundType === "net") return ENTITLEMENT_CANCEL_STATUSES.NET;
  return ENTITLEMENT_CANCEL_STATUSES.PRO_RATA;
}

export function isEntitlementEligibleForRefund(status) {
  return ACTIVE_ENTITLEMENT_STATUSES.has(status);
}

export function isRefundRecordTerminal(status) {
  return TERMINAL_REFUND_STATUSES.has(status);
}

export function normalizeRefundStatus(status) {
  if (status === "calculated" || status === "pending_review") {
    return REFUND_STATUS.PENDING_FINANCE;
  }
  if (status === "processed" || status === "refunded" || status === "approved") {
    return REFUND_STATUS.REIMBURSED;
  }
  return status;
}

export function shouldRequireManualReview(entitlement, orderEmail) {
  const registeredEmail = entitlement.customer_email?.trim().toLowerCase();
  const buyerEmail = (entitlement.buyer_email || orderEmail || "")
    .trim()
    .toLowerCase();
  if (!registeredEmail || !buyerEmail) return false;
  return registeredEmail !== buyerEmail;
}

export function extractRefundLineItems(refundPayload) {
  const items = [];
  const sources = [
    refundPayload.refund_line_items,
    refundPayload.refundLineItems,
    refundPayload.transactions,
  ];

  for (const refundLine of refundPayload.refund_line_items || []) {
    items.push({
      line_item_id: refundLine.line_item_id || refundLine.lineItemId,
      quantity: Number(refundLine.quantity) || 1,
      subtotal: refundLine.subtotal,
      restock_type: refundLine.restock_type,
    });
  }

  if (!items.length && Array.isArray(refundPayload.order_adjustments)) {
    for (const adj of refundPayload.order_adjustments) {
      if (adj.kind === "refund_discrepancy" || adj.kind === "shipping_refund") {
        items.push({ adjustment_only: true, kind: adj.kind, amount: adj.amount });
      }
    }
  }

  return items;
}

export function isPriceAdjustmentOnly(refundLineItems) {
  if (!refundLineItems?.length) return false;
  return refundLineItems.every(item => item.adjustment_only);
}

export function expandRefundLineItemsByQuantity(refundLineItems) {
  const expanded = [];
  for (const item of refundLineItems || []) {
    if (item.adjustment_only) continue;
    const qty = Math.max(1, Number(item.quantity) || 1);
    for (let i = 0; i < qty; i += 1) {
      expanded.push({
        line_item_id: normalizeLineItemId(item.line_item_id),
        unit_index: i,
        quantity: 1,
      });
    }
  }
  return expanded;
}

export function dedupeEntitlements(entitlements) {
  const seen = new Set();
  const result = [];
  for (const row of entitlements) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return result;
}
