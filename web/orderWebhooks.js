import shopify from "./shopify.js";
import { DeliveryMethod } from "@shopify/shopify-api";
import {
  resolveShopId,
  activateEntitlementFromPayment,
  cancelEntitlementFromRefund,
  getNumericIdFromGid,
  getActiveEntitlement,
} from "./services/extendedWarranty.service.js";

function extractEwAttributesFromLineItem(lineItem) {
  const attrs = lineItem.customAttributes || lineItem.properties || [];
  const map = {};
  for (const attr of attrs) {
    const key = attr.key || attr.name;
    if (key) map[key] = attr.value;
  }
  return {
    registerId: map._ew_register_id ? Number(map._ew_register_id) : null,
    planId: map._ew_plan_id ? Number(map._ew_plan_id) : null,
  };
}

function collectActivationTargets(orderPayload, graphqlLineItems = []) {
  const targets = new Map();

  const addTarget = (registerId, planId = null) => {
    if (!registerId || !Number.isFinite(registerId)) return;
    const existing = targets.get(registerId);
    targets.set(registerId, planId || existing || null);
  };

  for (const item of orderPayload.line_items || []) {
    const props = {};
    for (const prop of item.properties || []) {
      props[prop.name] = prop.value;
    }
    addTarget(
      props._ew_register_id ? Number(props._ew_register_id) : null,
      props._ew_plan_id ? Number(props._ew_plan_id) : null
    );
  }

  const tags = String(orderPayload.tags || "")
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean);

  for (const tag of tags) {
    const match = tag.match(/^ew-register-(\d+)$/i);
    if (match) addTarget(Number(match[1]));
  }

  for (const edge of graphqlLineItems) {
    const node = edge.node || edge;
    const { registerId, planId } = extractEwAttributesFromLineItem(node);
    addTarget(registerId, planId);
  }

  return targets;
}

function isOrderPaid(orderPayload) {
  const status = String(
    orderPayload.financial_status || orderPayload.displayFinancialStatus || ""
  ).toLowerCase();
  return status === "paid" || status === "partially_paid";
}

async function processExtendedWarrantyOrder(session, orderPayload) {
  if (!isOrderPaid(orderPayload)) {
    return;
  }

  const shopId = await resolveShopId(session.shop);
  if (!shopId) {
    console.error("❌ Order webhook: shop not registered", session.shop);
    return;
  }

  const orderId = orderPayload.admin_graphql_api_id
    ? getNumericIdFromGid(orderPayload.admin_graphql_api_id)
    : orderPayload.id;
  const orderGid =
    orderPayload.admin_graphql_api_id ||
    `gid://shopify/Order/${orderPayload.id}`;

  const admin = new shopify.api.clients.Graphql({ session });

  const response = await admin.request(
    `
    query OrderEwLineItems($id: ID!) {
      order(id: $id) {
        id
        name
        email
        displayFinancialStatus
        customer {
          displayName
        }
        lineItems(first: 50) {
          edges {
            node {
              id
              title
              customAttributes {
                key
                value
              }
            }
          }
        }
      }
      shop {
        name
      }
    }
    `,
    { variables: { id: orderGid } }
  );

  const order = response.data?.order;
  if (!order) return;

  if (order.displayFinancialStatus && order.displayFinancialStatus !== "PAID") {
    return;
  }

  const shopName = response.data?.shop?.name;
  const customerName = order.customer?.displayName || null;
  const customerEmail = order.email;
  const targets = collectActivationTargets(
    orderPayload,
    order.lineItems?.edges || []
  );

  for (const [registerId, planIdFromPayload] of targets) {
    let planId = planIdFromPayload;

    if (!planId) {
      const pending = await getActiveEntitlement(shopId, registerId);
      if (pending?.status === "pending_payment") {
        planId = pending.extended_warranty_plan_id;
      }
    }

    if (!planId) {
      console.warn(
        `⚠️ EW activation skipped: no plan for register=${registerId}, order=${orderId}`
      );
      continue;
    }

    try {
      await activateEntitlementFromPayment({
        shopId,
        registerId,
        planId,
        shopifyOrderId: String(orderId),
        shopifyOrderName: order.name,
        customerEmail,
        customerName,
        shopDisplayName: shopName,
      });
      console.log(
        `✅ Extended warranty activated: register=${registerId}, plan=${planId}, order=${orderId}`
      );
    } catch (err) {
      console.error("❌ EW activation failed:", err.message);
    }
  }
}

async function handleOrderWebhook(topic, shop, body) {
  const payload = JSON.parse(body);
  const sessions = await shopify.config.sessionStorage.findSessionsByShop(shop);
  if (!sessions?.length) return;

  await processExtendedWarrantyOrder(sessions[0], payload);
}

export const OrderWebhookHandlers = {
  ORDERS_PAID: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: handleOrderWebhook,
  },
  ORDERS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: handleOrderWebhook,
  },
  REFUNDS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body) => {
      const payload = JSON.parse(body);
      const shopId = await resolveShopId(shop);
      if (!shopId) return;

      const orderId = payload.order_id;
      if (!orderId) {
        console.warn("⚠️ REFUNDS_CREATE webhook: missing order_id in payload");
        return;
      }

      const outcome = await cancelEntitlementFromRefund({
        shopId,
        shopifyOrderId: String(orderId),
        shopifyRefundId: payload.id ? String(payload.id) : null,
        trigger: "shopify_refund",
      });

      if (!outcome.matched) {
        console.warn(
          `⚠️ REFUNDS_CREATE: no active EW entitlement for order ${orderId} (shop ${shop}). ` +
            "Refund requests are created only when the refunded order matches the EW purchase order " +
            "or the original product registration order."
        );
        return;
      }

      const created = outcome.results.filter(r => r.refundId);
      console.log(
        `✅ REFUNDS_CREATE processed order ${orderId}: ${created.length} refund request(s), ` +
          `${outcome.results.length - created.length} skipped`
      );
    },
  },
};

export async function registerOrderWebhooks(admin) {
  const appUrl = process.env.SHOPIFY_APP_URL || process.env.HOST;
  if (!appUrl) {
    console.warn("⚠️ SHOPIFY_APP_URL/HOST not set; skipping order webhook registration");
    return;
  }

  const callbackUrl = `${appUrl.replace(/\/$/, "")}/api/webhooks`;
  const topics = ["ORDERS_PAID", "ORDERS_CREATE", "REFUNDS_CREATE"];

  for (const topic of topics) {
    await admin.request(
      `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
        webhookSubscriptionCreate(
          topic: $topic
          webhookSubscription: { format: JSON, callbackUrl: $callbackUrl }
        ) {
          userErrors { field message }
          webhookSubscription { id }
        }
      }
      `,
      { variables: { topic, callbackUrl } }
    );
    console.log(`✅ ${topic} webhook registered → ${callbackUrl}`);
  }
}
