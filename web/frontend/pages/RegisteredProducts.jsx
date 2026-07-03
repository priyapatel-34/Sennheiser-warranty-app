import {
  Page,
  Layout,
  LegacyCard,
  IndexTable,
  Text,
  Badge,
  Button,
  Modal,
  TextField,
  Pagination,
  EmptyState,
  Select,
} from "@shopify/polaris";
import { useEffect, useState } from "react";
import LoadingPanel from "../components/LoadingPanel.jsx";
import { useToast } from "../hooks/useToast.js";

const PAGE_SIZE = 25;

const WARRANTY_TYPE_OPTIONS = [
  { label: "All warranty types", value: "all" },
  { label: "Standard Warranty", value: "standard" },
  { label: "Extended Warranty", value: "extended" },
];

const PURCHASE_TYPE_OPTIONS = [
  { label: "All purchase types", value: "all" },
  { label: "Shopify Purchase", value: "shopify" },
  { label: "External Purchase", value: "external" },
];

function TruncatedProductName({ name }) {
  if (!name) return "—";
  return (
    <span
      title={name}
      style={{
        display: "block",
        maxWidth: "220px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      <Text as="span" fontWeight="semibold">
        {name}
      </Text>
    </span>
  );
}

function formatWarrantyType(item) {
  const status = item.extended_warranty_status;
  if (status === "active") return "Extended (Active)";
  if (
    status === "pending_payment" &&
    item.extended_warranty_draft_order_id
  ) {
    return "Extended (Pending)";
  }
  if (status === "refunded") return "Extended (Refunded)";
  if (status === "cancelled") return "Extended (Cancelled)";
  if (status === "expired") return "Extended (Expired)";
  return "Standard";
}

function warrantyTone(item) {
  const status = item.extended_warranty_status;
  if (status === "active") return "success";
  if (
    status === "pending_payment" &&
    item.extended_warranty_draft_order_id
  ) {
    return "warning";
  }
  if (status === "refunded" || status === "cancelled" || status === "expired") {
    return "critical";
  }
  return "info";
}

export default function RegisteredProductsTable() {
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [warrantyTypeFilter, setWarrantyTypeFilter] = useState("all");
  const [purchaseTypeFilter, setPurchaseTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [paginationMeta, setPaginationMeta] = useState({
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });

  const [refreshKey, setRefreshKey] = useState(0);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
          sort: "created_at",
          order: "desc",
        });

        if (searchQuery) {
          params.set("q", searchQuery);
        }
        if (warrantyTypeFilter !== "all") {
          params.set("warrantyType", warrantyTypeFilter);
        }
        if (purchaseTypeFilter !== "all") {
          params.set("purchaseType", purchaseTypeFilter);
        }

        const res = await fetch(`/app/registered-products?${params.toString()}`);
        const json = await res.json();

        if (!res.ok) {
          throw new Error(json.error || "Failed to load registered products");
        }

        if (cancelled) return;

        setProducts(json.data || []);

        const meta = json.pagination || {};
        setPaginationMeta({
          total: meta.total || 0,
          totalPages: meta.totalPages || 1,
          hasNextPage: Boolean(meta.hasNextPage),
          hasPreviousPage: Boolean(meta.hasPreviousPage),
        });

        if (meta.page && meta.page !== page) {
          setPage(meta.page);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err.message || "Failed to load registered products";
        setError(message);
        setProducts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [page, searchQuery, warrantyTypeFilter, purchaseTypeFilter, refreshKey]);

  const runSearch = () => {
    setPage(1);
    setSearchQuery(searchInput.trim());
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearchQuery("");
    setWarrantyTypeFilter("all");
    setPurchaseTypeFilter("all");
    setPage(1);
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
    setPage(1);
  };

  const handleDeleteClick = product => {
    setSelectedProduct(product);
    setDeleteModalOpen(true);
  };

  const handleDeleteProduct = async () => {
    if (!selectedProduct) return;

    try {
      setDeleteLoading(true);
      const response = await fetch(
        `/app/registered-products/${selectedProduct.id}`,
        { method: "DELETE" }
      );
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to delete product");
      }

      toast.showSuccess("Registered product deleted");
      setDeleteModalOpen(false);
      setSelectedProduct(null);
      setRefreshKey(k => k + 1);
    } catch (err) {
      toast.showError(err.message || "Failed to delete product");
    } finally {
      setDeleteLoading(false);
    }
  };

  const showPagination =
    !loading && !error && paginationMeta.totalPages > 1;

  return (
    <>
      <Page title="Registered Products" fullWidth>
        <Layout>
          <Layout.Section>
            <LegacyCard sectioned>
              <Text as="p" tone="subdued">
                Search by customer name, email, serial number, product name, SKU, or registration ID.
              </Text>
              <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <TextField
                    label="Search"
                    labelHidden
                    value={searchInput}
                    onChange={setSearchInput}
                    placeholder="Search registered products..."
                    autoComplete="off"
                    onKeyDown={e => {
                      if (e.key === "Enter") runSearch();
                    }}
                    clearButton
                    onClearButtonClick={clearSearch}
                    connectedRight={
                      <Button variant="primary" onClick={runSearch}>
                        Search
                      </Button>
                    }
                  />
                </div>
                <div style={{ minWidth: 180 }}>
                  <Select
                    label="Warranty type"
                    labelHidden
                    options={WARRANTY_TYPE_OPTIONS}
                    value={warrantyTypeFilter}
                    onChange={v => {
                      setPage(1);
                      setWarrantyTypeFilter(v);
                    }}
                  />
                </div>
                <div style={{ minWidth: 180 }}>
                  <Select
                    label="Purchase type"
                    labelHidden
                    options={PURCHASE_TYPE_OPTIONS}
                    value={purchaseTypeFilter}
                    onChange={v => {
                      setPage(1);
                      setPurchaseTypeFilter(v);
                    }}
                  />
                </div>
                {searchQuery ||
                  warrantyTypeFilter !== "all" ||
                  purchaseTypeFilter !== "all" ? (
                  <Button onClick={clearFilters}>Clear all</Button>
                ) : null}
              </div>
            </LegacyCard>

            <LegacyCard>
              {loading ? (
                <LoadingPanel label="Loading registered products..." />
              ) : error ? (
                <EmptyState heading="Unable to load products" image="">
                  <p>{error}</p>
                  <Button onClick={() => setRefreshKey(k => k + 1)}>
                    Retry
                  </Button>
                </EmptyState>
              ) : products.length === 0 ? (
                <EmptyState heading="No registered products found" image="">
                  <p>
                    {searchQuery
                      ? "No results match your search."
                      : "No registered products yet."}
                  </p>
                </EmptyState>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <IndexTable
                    resourceName={{ singular: "product", plural: "products" }}
                    itemCount={products.length}
                    selectable={false}
                    headings={[
                      { title: "ID" },
                      { title: "Product" },
                      { title: "Serial No" },
                      { title: "SKU" },
                      { title: "Customer" },
                      { title: "Email" },
                      { title: "Warranty Type" },
                      { title: "Purchase Type" },
                      { title: "Warranty End" },
                      { title: "EW End" },
                      { title: "Actions" },
                    ]}
                  >
                    {products.map((item, index) => (
                      <IndexTable.Row
                        id={String(item.id)}
                        key={item.id}
                        position={index}
                      >
                        <IndexTable.Cell>{item.id}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <TruncatedProductName name={item.product_name} />
                        </IndexTable.Cell>
                        <IndexTable.Cell>{item.serial_number}</IndexTable.Cell>
                        <IndexTable.Cell>{item.sku || "—"}</IndexTable.Cell>
                        <IndexTable.Cell>{item.customer_name || "—"}</IndexTable.Cell>
                        <IndexTable.Cell>{item.customer_email}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <Badge tone={warrantyTone(item)}>
                            {formatWarrantyType(item)}
                          </Badge>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Badge tone={item.purchase_type === "shopify" ? "success" : "info"}>
                            {item.purchase_type === "shopify"
                              ? "Shopify Purchase"
                              : "External Purchase"}
                          </Badge>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{item.warranty_end || "—"}</IndexTable.Cell>
                        <IndexTable.Cell>
                          {item.extended_warranty_end || "—"}
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
                    ))}
                  </IndexTable>

                  <div
                    style={{
                      padding: 16,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 12,
                    }}
                  >
                    <Text as="p" tone="subdued">
                      {paginationMeta.total} result
                      {paginationMeta.total === 1 ? "" : "s"}
                    </Text>
                    {showPagination ? (
                      <Pagination
                        hasPrevious={paginationMeta.hasPreviousPage}
                        onPrevious={() => setPage(p => Math.max(1, p - 1))}
                        hasNext={paginationMeta.hasNextPage}
                        onNext={() => setPage(p => p + 1)}
                        label={`Page ${page} of ${paginationMeta.totalPages}`}
                      />
                    ) : null}
                  </div>
                </div>
              )}
            </LegacyCard>
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
          <Text as="p">
            Are you sure you want to delete{" "}
            <strong>{selectedProduct?.product_name}</strong>?
          </Text>
        </Modal.Section>
      </Modal>
    </>
  );
}
