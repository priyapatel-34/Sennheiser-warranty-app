const MS_PER_DAY = 86400000;
/** Show "Extension Offer Expires in X Days" only when this many days or fewer remain. */
const EXTENSION_OFFER_EXPIRY_LABEL_MAX_DAYS = 10;

/**
 * Registration timestamp for purchase-window math.
 * Must NOT use warranty_start or purchase_date — those are not registration time.
 */
function parseDateValue(raw) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : new Date(raw.getTime());
  }

  const str = String(raw).trim();
  if (!str) return null;

  const normalized =
    str.includes(" ") && !str.includes("T") ? str.replace(" ", "T") : str;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function resolveRegistrationTimestamp(registered) {
  const raw =
    registered?.created_at ??
    registered?.registered_at ??
    registered?.registration_date;

  return parseDateValue(raw);
}

function utcDayIndex(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Single source of truth for extended warranty purchase window eligibility.
 *
 * Uses UTC calendar days from registration (matches admin "Days after registration").
 * purchaseDays = N → eligible while elapsed calendar days < N.
 * Example: N=1 → registration day only; N=90 → days 0–89 after registration.
 */
export function computePurchaseWindowState({
  purchaseDays,
  registered,
  now = new Date(),
  logContext = null,
}) {
  if (purchaseDays == null || purchaseDays === "") {
    return { allowed: true, configured: false };
  }

  const extendedWarrantyPurchaseDays = Number(purchaseDays);
  if (!Number.isFinite(extendedWarrantyPurchaseDays) || extendedWarrantyPurchaseDays < 0) {
    return { allowed: true, configured: false };
  }

  const registrationDate = resolveRegistrationTimestamp(registered);
  if (!registrationDate) {
    const missing = {
      allowed: false,
      configured: true,
      reason: "registration_date_missing",
      extendedWarrantyPurchaseDays,
    };
    logPurchaseWindow(logContext, { registrationDate: null, result: missing });
    return missing;
  }

  const daysSinceRegistration = Math.floor(
    (utcDayIndex(now) - utcDayIndex(registrationDate)) / MS_PER_DAY
  );
  const allowed = daysSinceRegistration < extendedWarrantyPurchaseDays;
  const daysRemaining = allowed
    ? extendedWarrantyPurchaseDays - daysSinceRegistration
    : 0;

  // First instant of the first UTC day after the purchase window closes.
  const purchaseExpiryDate = new Date(
    utcDayIndex(registrationDate) + extendedWarrantyPurchaseDays * MS_PER_DAY
  );
  const lastEligibleDate = new Date(
    utcDayIndex(registrationDate) + (extendedWarrantyPurchaseDays - 1) * MS_PER_DAY
  );

  const result = {
    allowed,
    configured: true,
    extendedWarrantyPurchaseDays,
    registrationDate: registrationDate.toISOString(),
    purchaseExpiryDate: purchaseExpiryDate.toISOString(),
    lastEligibleDate: lastEligibleDate.toISOString(),
    daysSinceRegistration,
    daysRemaining,
  };

  if (!allowed) {
    result.reason = "purchase_window_expired";
    result.daysRemaining = 0;
  }

  logPurchaseWindow(logContext, {
    registrationDate: result.registrationDate,
    currentDate: now.toISOString(),
    purchaseWindowDays: extendedWarrantyPurchaseDays,
    expiryDate: result.purchaseExpiryDate,
    daysSinceRegistration,
    daysRemaining: result.daysRemaining,
    allowed,
    eligible: allowed,
  });

  return result;
}

function logPurchaseWindow(context, payload) {
  if (!context) return;
}

export function formatExtensionOfferExpiryLabel(purchaseWindow) {
  if (!purchaseWindow?.configured) return null;

  if (
    !purchaseWindow.allowed &&
    purchaseWindow.reason === "purchase_window_expired"
  ) {
    return { label: "Extension Offer Expired", expired: true };
  }

  const remaining = Number(purchaseWindow.daysRemaining);
  if (!Number.isFinite(remaining)) return null;

  if (remaining > EXTENSION_OFFER_EXPIRY_LABEL_MAX_DAYS) return null;

  const purchaseDays = Number(purchaseWindow.extendedWarrantyPurchaseDays);

  if (remaining === 0) {
    return { label: "Offer Expires Today", expired: false };
  }
  if (remaining === 1) {
    if (purchaseDays === 1) {
      return { label: "Offer Expires Today", expired: false };
    }
    return { label: "Extension Offer Expires Tomorrow", expired: false };
  }
  return {
    label: `Extension Offer Expires in ${remaining} Days`,
    expired: false,
  };
}
