import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Spinner,
  Badge,
  Box,
  useIndexResourceState,
} from "@shopify/polaris";
import { useEffect, useState } from "react";

export default function RegisteredProductsTable() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
  } = useIndexResourceState(products);

  useEffect(() => {    
    console.log("✅ RegisteredProducts mounted");
    console.log("Origin:", window.location.origin);
    console.log("Current URL:", window.location.href);
    setLoading(true);
    fetchRegisteredProducts();
  }, []);

  
  const fetchRegisteredProducts = async () => {
    try {
      console.log("🚀 Fetching registered products...");
  
      const res = await fetch("/app/registered-products/"); 
  
      console.log("📡 Response status:", res.status);
      console.log("📡 Response URL:", res.url);
  
      const text = await res.text();
      console.log("📦 Raw response:", text);
  
      const json = JSON.parse(text);
      setProducts(json.data || []);
  
    } catch (error) {
      console.error("❌ Error loading registered products", error);
    } finally {
      setLoading(false);
    }
    
  };

  const rowMarkup = products.map((item, index) => (
    <IndexTable.Row
      id={item.id}
      key={item.id}
      selected={selectedResources.includes(item.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Text fontWeight="medium">{item.product_name}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{item.serial_number}</IndexTable.Cell>
      <IndexTable.Cell>{item.sku || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{item.customer_name || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{item.customer_email}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge status={item.purchase_type === "shopify" ? "success" : "info"}>
          {item.purchase_type}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{item.retailer_name || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{item.purchase_date || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{item.warranty_start}</IndexTable.Cell>
      <IndexTable.Cell>{item.warranty_end}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge status={item.consent_terms ? "success" : "critical"}>
          {item.consent_terms ? "Yes" : "No"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge status={item.consent_marketing ? "success" : "warning"}>
          {item.consent_marketing ? "Yes" : "No"}
        </Badge>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Registered Products"
      fullWidth
    >
      <Layout>
        <Layout.Section>
          <Box >
            <Card roundedAbove="sm">
              {loading ? (
                <Box padding="600" align="center">
                  <Spinner size="large" />
                </Box>
              ) : (
                <IndexTable
                  resourceName={{ singular: "product", plural: "products" }}
                  itemCount={products.length}
                  selectedItemsCount={
                    allResourcesSelected ? "All" : selectedResources.length
                  }
                  onSelectionChange={handleSelectionChange}
                  headings={[
                    { title: "Product" },
                    { title: "Serial No" },
                    { title: "SKU" },
                    { title: "Customer" },
                    { title: "Email" },
                    { title: "Purchase Type" },
                    { title: "Retailer" },
                    { title: "Purchase Date" },
                    { title: "Warranty Start" },
                    { title: "Warranty End" },
                    { title: "Terms" },
                    { title: "Marketing" },
                  ]}
                >
                  {rowMarkup}
                </IndexTable>
              )}
            </Card>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

