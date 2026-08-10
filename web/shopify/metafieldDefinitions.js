/**
 * Ensures the standard warranty duration metafield definition exists in the
 * merchant's Shopify admin so product data can store warranty duration values.
 */
export async function createStandardWarrantyMetafield(admin) {
    // 🔍 STEP 1: check if definition exists
    const check = await admin.request(`
      query {
        metafieldDefinitions(
          first: 10
          ownerType: PRODUCT
          namespace: "warranty"
          key: "standard_duration"
        ) {
          edges {
            node {
              id
            }
          }
        }
      }
    `);
  
    if (check.data.metafieldDefinitions.edges.length > 0) {
      console.log("✅ Warranty metafield definition already exists");
      return;
    }
  
    // 🧱 STEP 2: create definition
    const create = await admin.request(`
      mutation {
        metafieldDefinitionCreate(
          definition: {
            name: "Standard Warranty Duration"
            namespace: "warranty"
            key: "standard_duration"
            type: "number_integer"
            ownerType: PRODUCT
            description: "Standard warranty duration in years"
            pin: true
          }
        ) {
          createdDefinition {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `);
  
    if (create.data.metafieldDefinitionCreate.userErrors.length) {
      console.error(
        "❌ Metafield definition create errors:",
        create.data.metafieldDefinitionCreate.userErrors
      );
    } else {
      console.log(
        "✅ Metafield definition created:",
        create.data.metafieldDefinitionCreate.createdDefinition.id
      );
    }
}  

/**
 * Removes the standard warranty duration metafield definition when the app no
 * longer needs to persist warranty duration metadata on products.
 */
export async function deleteStandardWarrantyMetafield(admin) {
    // 1️⃣ Find definition ID
    const response = await admin.request(`
      query {
        metafieldDefinitions(
          first: 1,
          ownerType: PRODUCT,
          namespace: "warranty",
          key: "standard_duration"
        ) {
          edges {
            node { id }
          }
        }
      }
    `);
  
    const definition =
      response.data.metafieldDefinitions.edges[0]?.node;
  
    if (!definition) {
      return; // already removed
    }
  
    // 2️⃣ Delete definition
    await admin.request(`
      mutation {
        metafieldDefinitionDelete(
          id: "${definition.id}"
        ) {
          deletedDefinitionId
          userErrors { message }
        }
      }
    `);
}
