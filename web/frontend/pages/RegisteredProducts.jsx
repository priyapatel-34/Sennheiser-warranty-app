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
  Card,
  LegacyStack,
  Grid,
  Spinner,
} from "@shopify/polaris";
import { useEffect, useState } from "react";
import LoadingPanel from "../components/LoadingPanel.jsx";
import { useToast } from "../hooks/useToast.js";
import { formatDate } from "../utils/formatDate.js";

const PAGE_SIZE = 25;

const WARRANTY_TYPE_OPTIONS = [
  { label: "All statuses", value: "all" },
  { label: "Standard warranty", value: "standard" },
  { label: "Extended warranty", value: "extended" },
  { label: "Active warranty", value: "extended_active" },
  { label: "Pending payment", value: "extended_pending" },
];

const PURCHASE_TYPE_OPTIONS = [
  { label: "All purchase types", value: "all" },
  { label: "Shopify Purchase", value: "shopify" },
  { label: "External Purchase", value: "external" },
];

const sectionLabelStyle = {
  fontSize: 11,
  fontWeight: 600,
  color: "#6d7175",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 4,
};

function TruncatedText({ value, maxWidth = "180px", bold = false }) {
  if (!value) return "—";
  return (
    <span
      title={value}
      style={{
        display: "block",
        maxWidth,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {bold ? (
        <Text as="span" fontWeight="semibold">{value}</Text>
      ) : (
        value
      )}
    </span>
  );
}

function DetailField({ label, value, isDate = false }) {
  const display = isDate ? formatDate(value) : (value || "—");
  return (
    <div>
      <div style={sectionLabelStyle}>{label}</div>
      <Text as="p">{display}</Text>
    </div>
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

function formatOrderNo(item) {
  return item.order_number || "—";
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

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [productDetail, setProductDetail] = useState(null);

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

  const handleDeleteClick = (product, event) => {
    event.stopPropagation();
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
      if (detailOpen && productDetail?.id === selectedProduct.id) {
        setDetailOpen(false);
        setProductDetail(null);
      }
      setRefreshKey(k => k + 1);
    } catch (err) {
      toast.showError(err.message || "Failed to delete product");
    } finally {
      setDeleteLoading(false);
    }
  };

  const openRegistrationDetails = async product => {
    setDetailOpen(true);
    setDetailLoading(true);
    setProductDetail(null);

    try {
      const res = await fetch(`/app/registered-products/${product.id}`);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load product details");
      }

      setProductDetail(json.data);
    } catch (err) {
      toast.showError(err.message || "Failed to load product details");
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleViewClick = (product, event) => {
    event.stopPropagation();
    openRegistrationDetails(product);
  };

  const closeDetailModal = () => {
    setDetailOpen(false);
    setProductDetail(null);
  };

  const showPagination =
    !loading && !error && paginationMeta.totalPages > 1;

  return (
    <>
      <Page title="Registered Products" fullWidth>
        <Layout>
          <Layout.Section>
            <LegacyCard sectioned>
              <Text as="p" variant="bodySm" tone="subdued">
                Search by name, email, serial no., SKU, product name, or warranty record ID.
                {" "}To search by order number, use the <strong>#</strong> prefix — e.g.{" "}
                <strong>#1082</strong>.
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
                <div style={{ minWidth: 190 }}>
                  <Select
                    label="Warranty status"
                    labelHidden
                    options={WARRANTY_TYPE_OPTIONS}
                    value={warrantyTypeFilter}
                    onChange={(v) => {
                      setWarrantyTypeFilter(v);
                      setPage(1);
                    }}
                  />
                </div>
                <div style={{ minWidth: 180 }}>
                  <Select
                    label="Purchase type"
                    labelHidden
                    options={PURCHASE_TYPE_OPTIONS}
                    value={purchaseTypeFilter}
                    onChange={(v) => {
                      setPurchaseTypeFilter(v);
                      setPage(1);
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
                <div className="wa-registered-products-table" style={{ overflowX: "auto" }}>
                  <IndexTable
                    resourceName={{ singular: "product", plural: "products" }}
                    itemCount={products.length}
                    selectable={false}
                    headings={[
                      { title: "Warranty Record ID" },
                      { title: "Customer" },
                      { title: "Product" },
                      { title: "Serial Number" },
                      { title: "Purchase Type" },
                      { title: "Order Number" },
                      { title: "SKU" },
                      { title: "Email" },
                      { title: "Warranty Type" },
                      { title: "Warranty End" },
                      { title: "Extended Warranty End" },
                      { title: "Actions" },
                    ]}
                  >
                    {products.map((item, index) => (
                      <IndexTable.Row
                        id={String(item.id)}
                        key={item.id}
                        position={index}
                        onClick={() => openRegistrationDetails(item)}
                      >
                        <IndexTable.Cell>{item.id}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <TruncatedText value={item.customer_name} maxWidth="160px" />
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <TruncatedText value={item.product_name} maxWidth="220px" bold />
                        </IndexTable.Cell>
                        <IndexTable.Cell>{item.serial_number}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <Badge tone={item.purchase_type === "shopify" ? "success" : "info"}>
                            {item.purchase_type === "shopify"
                              ? "Shopify Purchase"
                              : "External Purchase"}
                          </Badge>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{formatOrderNo(item)}</IndexTable.Cell>
                        <IndexTable.Cell>{item.sku || "—"}</IndexTable.Cell>
                        <IndexTable.Cell>{item.customer_email}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <Badge tone={warrantyTone(item)}>
                            {formatWarrantyType(item)}
                          </Badge>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{formatDate(item.warranty_end)}</IndexTable.Cell>
                        <IndexTable.Cell>{formatDate(item.extended_warranty_end)}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <div
                            className="wa-row-actions"
                            style={{ display: "flex", gap: 8 }}
                            onClick={e => e.stopPropagation()}
                          >
                            <Button
                              size="micro"
                              onClick={e => handleViewClick(item, e)}
                            >
                              View
                            </Button>
                            <Button
                              tone="critical"
                              size="micro"
                              onClick={e => handleDeleteClick(item, e)}
                            >
                              Delete
                            </Button>
                          </div>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>

                  <div className="wa-pagination-bar" style={{ padding: 16 }}>
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
        open={detailOpen}
        onClose={closeDetailModal}
        title={
          productDetail?.product_name
            ? `Warranty Record #${productDetail.id} — ${productDetail.product_name}`
            : "Warranty Record Details"
        }
        large
        secondaryActions={[
          { content: "Close", onAction: closeDetailModal },
        ]}
      >
        <Modal.Section>
          {detailLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
              <Spinner accessibilityLabel="Loading registration details" size="large" />
            </div>
          ) : productDetail ? (
            <LegacyStack vertical spacing="loose">
              <Card title="Registration Information" sectioned>
                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Warranty Record ID" value={String(productDetail.id)} />
                  </Grid.Cell>
                  {productDetail.purchase_type !== "External Purchase" && (
                    <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                      <DetailField label="Order Number" value={productDetail.order_number} />
                    </Grid.Cell>
                  )}
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Serial Number" value={productDetail.serial_number} />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="SKU" value={productDetail.sku} />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Product Name" value={productDetail.product_name} />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Product Variant" value={productDetail.product_variant} />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Purchase Type" value={productDetail.purchase_type} />
                  </Grid.Cell>
                  {productDetail.purchase_type === "External Purchase" && (
                    <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                      <DetailField label="Retailer Name" value={productDetail.retailer_name} />
                    </Grid.Cell>
                  )}
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Warranty Type" value={productDetail.warranty_type} />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Purchase Date" value={productDetail.purchase_date} isDate />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Registration Date" value={productDetail.registration_date} isDate />
                  </Grid.Cell>
                </Grid>
              </Card>

              <Card title="Customer Information" sectioned>
                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Customer Name" value={productDetail.customer_name} />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Email" value={productDetail.customer_email} />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Shopify Customer ID" value={productDetail.shopify_customer_id} />
                  </Grid.Cell>
                </Grid>
              </Card>

              <Card title="Warranty Information" sectioned>
                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Standard Warranty Start" value={productDetail.warranty_start} isDate />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Standard Warranty End" value={productDetail.warranty_end} isDate />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Extended Warranty Start" value={productDetail.extended_warranty_start} isDate />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Extended Warranty End" value={productDetail.extended_warranty_end} isDate />
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                    <DetailField label="Refund Status" value={productDetail.refund_status} />
                  </Grid.Cell>
                </Grid>
              </Card>
            </LegacyStack>
          ) : null}
        </Modal.Section>
      </Modal>

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
