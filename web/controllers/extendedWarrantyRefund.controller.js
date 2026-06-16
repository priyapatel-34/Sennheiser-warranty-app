import {
  listRefundRequests,
  getRefundRequestDetail,
  approveRefundRequest,
  rejectRefundRequest,
  completeRefundRequest,
  cancelRefundRequest,
  createManualRefundRequest,
  getRefundSettings,
  saveRefundSettings,
} from "../services/extendedWarrantyRefund.service.js";
import { pool } from "../db/mysql.js";

async function resolveShopId(session) {
  const [[shopRow]] = await pool.query(
    `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
    [session.shop]
  );
  return shopRow?.id ?? null;
}

function getActor(req, res) {
  return res.locals?.shopify?.session?.shop || "admin";
}

export async function listEWRefundRequests(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const result = await listRefundRequests(shopId, {
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      q: req.query.q || req.query.search,
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("❌ listEWRefundRequests error:", err);
    return res.status(500).json({ error: "Failed to load refund requests" });
  }
}

export async function getEWRefundRequest(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const detail = await getRefundRequestDetail(shopId, Number(req.params.id));
    if (!detail) {
      return res.status(404).json({ error: "Refund request not found" });
    }

    return res.json({ success: true, refund: detail });
  } catch (err) {
    console.error("❌ getEWRefundRequest error:", err);
    return res.status(500).json({ error: "Failed to load refund request" });
  }
}

export async function approveEWRefundRequest(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const actor = session.shop;
    const refund = await approveRefundRequest(
      shopId,
      Number(req.params.id),
      actor,
      req.body?.adminNotes || null
    );

    return res.json({ success: true, refund });
  } catch (err) {
    console.error("❌ approveEWRefundRequest error:", err);
    return res.status(400).json({ error: err.message || "Approval failed" });
  }
}

export async function rejectEWRefundRequest(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const actor = session.shop;
    const refund = await rejectRefundRequest(
      shopId,
      Number(req.params.id),
      actor,
      req.body?.rejectionReason || "Refund request rejected"
    );

    return res.json({ success: true, refund });
  } catch (err) {
    console.error("❌ rejectEWRefundRequest error:", err);
    return res.status(400).json({ error: err.message || "Rejection failed" });
  }
}

export async function completeEWRefundRequest(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const actor = session.shop;
    const refund = await completeRefundRequest(
      shopId,
      Number(req.params.id),
      actor,
      req.body?.adminNotes || null
    );

    return res.json({ success: true, refund });
  } catch (err) {
    console.error("❌ completeEWRefundRequest error:", err);
    return res.status(400).json({ error: err.message || "Completion failed" });
  }
}

export async function cancelEWRefundRequest(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const actor = session.shop;
    const refund = await cancelRefundRequest(
      shopId,
      Number(req.params.id),
      actor,
      req.body?.reason || "Refund request cancelled"
    );

    return res.json({ success: true, refund });
  } catch (err) {
    console.error("❌ cancelEWRefundRequest error:", err);
    return res.status(400).json({ error: err.message || "Cancellation failed" });
  }
}

export async function createEWManualRefundRequest(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const { entitlementId, reason, claimCost } = req.body || {};
    if (!entitlementId) {
      return res.status(400).json({ error: "entitlementId is required" });
    }

    const result = await createManualRefundRequest({
      shopId,
      entitlementId: Number(entitlementId),
      reason,
      claimCost: Number(claimCost) || 0,
      actor: session.shop,
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("❌ createEWManualRefundRequest error:", err);
    return res.status(400).json({ error: err.message || "Failed to create refund request" });
  }
}

export async function exportEWRefundRequests(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const { exportRefundRequestsCsv } = await import(
      "../services/extendedWarrantyRefund.service.js"
    );
    const csv = await exportRefundRequestsCsv(shopId, {
      status: req.query.status,
      q: req.query.q || req.query.search,
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="extended-warranty-refunds.csv"'
    );
    return res.send(csv);
  } catch (err) {
    console.error("❌ exportEWRefundRequests error:", err);
    return res.status(500).json({ error: "Failed to export refund requests" });
  }
}

export async function getEWRefundSettings(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const settings = await getRefundSettings(shopId);

    return res.json({
      success: true,
      settings: {
        refundEnabled: Boolean(settings.refund_enabled),
        proRataEnabled: Boolean(settings.pro_rata_enabled),
        refundPercentage: Number(settings.refund_percentage),
        cancelOnRefund: Boolean(settings.cancel_on_refund),
        minimumUsedDays: Number(settings.minimum_used_days),
        eligibilityWindowDays: settings.eligibility_window_days,
        autoCancelEntitlement: Boolean(
          settings.auto_cancel_entitlement ?? settings.cancel_on_refund
        ),
        financeNotificationEmails: settings.finance_notification_emails || "",
      },
    });
  } catch (err) {
    console.error("❌ getEWRefundSettings error:", err);
    return res.status(500).json({ error: "Failed to load refund settings" });
  }
}

export async function saveEWRefundSettings(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    await saveRefundSettings(shopId, req.body);

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ saveEWRefundSettings error:", err);
    return res.status(500).json({ error: "Failed to save refund settings" });
  }
}
