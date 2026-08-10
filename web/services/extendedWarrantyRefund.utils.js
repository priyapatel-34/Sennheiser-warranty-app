const MS_PER_DAY = 86400000;

/**
 * Normalizes a date-like value to midnight so refund calculations compare
 * whole days instead of partial timestamps.
 */
function toDateOnly(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Computes the non-negative number of whole days between two dates for
 * coverage and refund math.
 */
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
