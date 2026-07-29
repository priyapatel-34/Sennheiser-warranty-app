/**
 * Registers the PRODUCTS_UPDATE webhook if a subscription for that topic
 * pointing to this app's URL does not already exist.
 *
 * Running webhookSubscriptionCreate unconditionally on every auth callback
 * accumulates duplicate subscriptions; Shopify does not deduplicate them.
 * This guard prevents that.
 */
export async function registerProductUpdateWebhook(admin) {
  const appUrl = (process.env.SHOPIFY_APP_URL || process.env.HOST || "").replace(/\/$/, "");
  if (!appUrl) {
    console.warn("⚠️ SHOPIFY_APP_URL / HOST not set — skipping PRODUCTS_UPDATE webhook");
    return;
  }

  const callbackUrl = `${appUrl}/api/webhooks`;

  // Check whether a subscription for this topic already exists for this app.
  const existing = await admin.request(`
    query {
      webhookSubscriptions(first: 10, topics: PRODUCTS_UPDATE) {
        edges {
          node {
            id
            endpoint {
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
        }
      }
    }
  `);

  const alreadyRegistered = (existing.data?.webhookSubscriptions?.edges || []).some(
    (e) => e.node?.endpoint?.callbackUrl === callbackUrl
  );

  if (alreadyRegistered) {
    console.log("✅ PRODUCTS_UPDATE webhook already registered — skipping");
    return;
  }

  const result = await admin.request(
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
    { variables: { topic: "PRODUCTS_UPDATE", callbackUrl } }
  );

  const errors = result.data?.webhookSubscriptionCreate?.userErrors || [];
  if (errors.length) {
    console.error("❌ PRODUCTS_UPDATE webhook registration errors:", errors);
  } else {
    console.log(`✅ PRODUCTS_UPDATE webhook registered → ${callbackUrl}`);
  }
}
