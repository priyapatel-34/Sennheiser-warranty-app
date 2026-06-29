export async function registerProductUpdateWebhook(admin) {
    await admin.request(`
      mutation {
        webhookSubscriptionCreate(
          topic: PRODUCTS_UPDATE
          webhookSubscription: {
            format: JSON
            callbackUrl: "https://dechbwarrantyweuprd-bngbh9cmggcadxgm.westeurope-01.azurewebsites.net/webhooks/products/update"
          }
        ) {
          userErrors {
            field
            message
          }
          webhookSubscription {
            id
          }
        }
      }
    `);
  
    console.log("✅ PRODUCTS_UPDATE webhook registered");
  }
  