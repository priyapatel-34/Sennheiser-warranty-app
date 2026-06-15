import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Spinner,
  Badge,
  Box,
  Button,
  Modal,
  useIndexResourceState,
} from "@shopify/polaris";
import { useEffect, useState } from "react";

export default function RegisteredProductsTable() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  // delete
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(products);

  useEffect(() => {
    console.log("✅ RegisteredProducts mounted");
    console.log("Origin:", window.location.origin);
    console.log("Current URL:", window.location.href);
    setLoading(true);
    fetchRegisteredProducts();
  }, []);

  const fetchRegisteredProducts = async () => {
    try {
      setLoading(true);

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

  // delete
  const handleDeleteClick = (product) => {
    setSelectedProduct(product);
    setDeleteModalOpen(true);
  };

  // delete
  const handleDeleteProduct = async () => {
    if (!selectedProduct) return;

    try {
      setDeleteLoading(true);

      const response = await fetch(
        `/app/registered-products/${selectedProduct.id}`,
        {
          method: "DELETE",
        },
      );

      const data = await response.json();

      if (data.success) {
        setProducts((prev) =>
          prev.filter((item) => item.id !== selectedProduct.id),
        );
      }

      if (!response.ok) {
        throw new Error(data.message || "Failed to delete product");
      }

      setDeleteModalOpen(false);
      setSelectedProduct(null);

      console.log("✅ Product deleted successfully");
    } catch (error) {
      console.error("❌ Delete failed:", error);
      alert("Failed to delete product");
    } finally {
      setDeleteLoading(false);
    }
  };

  const rowMarkup = products.map((item, index) => (
    <IndexTable.Row
      id={String(item.id)}
      key={item.id}
      selected={selectedResources.includes(String(item.id))}
      position={index}
    >
      <IndexTable.Cell>
        <Text as="span" fontWeight="medium">
          {item.product_name}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{item.serial_number}</IndexTable.Cell>
      <IndexTable.Cell>{item.sku || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{item.customer_name || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{item.customer_email}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={item.purchase_type === "shopify" ? "success" : "info"}>
          {item.purchase_type}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{item.retailer_name || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{item.purchase_date || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{item.warranty_start}</IndexTable.Cell>
      <IndexTable.Cell>{item.warranty_end}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={item.consent_terms ? "success" : "critical"}>
          {item.consent_terms ? "Yes" : "No"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={item.consent_marketing ? "success" : "warning"}>
          {item.consent_marketing ? "Yes" : "No"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button
          tone="critical"
          size="micro"
          onClick={() => handleDeleteClick(item)}
        >
          Delete
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <>
      <Page title="Registered Products" fullWidth>
        <Layout>
          <Layout.Section>
            <Box>
              <Card>
                {loading ? (
                  <Box padding="600">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                      }}
                    >
                      <Spinner size="large" />
                    </div>
                  </Box>
                ) : (
                  <IndexTable
                    resourceName={{
                      singular: "product",
                      plural: "products",
                    }}
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
                      { title: "Actions" },
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
      <Modal
        open={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setSelectedProduct(null);
        }}
        title="Delete Registered Product"
        primaryAction={{
          content: "Delete",
          destructive: true,
          loading: deleteLoading,
          onAction: handleDeleteProduct,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setDeleteModalOpen(false);
              setSelectedProduct(null);
            },
          },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            Are you sure you want to delete{" "}
            <strong>{selectedProduct?.product_name}</strong>?
          </Text>

          <Box paddingBlockStart="300">
            <Text as="p" variant="bodyMd" tone="critical">
              This action cannot be undone.
            </Text>
          </Box>
        </Modal.Section>
      </Modal>
    </>
  );
}
 