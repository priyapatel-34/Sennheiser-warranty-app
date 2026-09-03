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
import { useCallback, useEffect, useState } from "react";
import LoadingPanel from "../components/LoadingPanel.jsx";
import { useToast } from "../hooks/useToast.js";
import { formatDate } from "../utils/formatDate.js";

const PAGE_SIZE = 25;
const ALL_FILTER = "all";
const SHOPIFY_PURCHASE = "shopify";
const EXTERNAL_PURCHASE = "external";
const EXTERNAL_PURCHASE_LABEL = "External Purchase";
const REGISTERED_PRODUCTS_URL = "/app/registered-products";

const WARRANTY_TYPE_OPTIONS = [
  { label: "All statuses", value: ALL_FILTER },
  { label: "Standard warranty", value: "standard" },
  { label: "Extended warranty", value: "extended" },
];

const PURCHASE_TYPE_OPTIONS = [
  { label: "All purchase types", value: ALL_FILTER },
  { label: "Shopify Purchase", value: SHOPIFY_PURCHASE },
  { label: EXTERNAL_PURCHASE_LABEL, value: EXTERNAL_PURCHASE },
];

const SECTION_LABEL_STYLE = {
  fontSize: 11,
  fontWeight: 600,
  color: "#6d7175",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 4,
};

const DETAIL_CELL_SPAN = {
  xs: 6,
  sm: 3,
  md: 3,
  lg: 4,
  xl: 4,
};

const CSV_HEADERS = [
  "Warranty Record ID",
  "Customer",
  "Product",
  "Serial Number",
  "Purchase Type",
  "Order Number",
  "SKU",
  "Email",
  "Warranty Type",
  "Warranty End",
  "Extended Warranty End",
];

const WARRANTY_STATUS_LABELS = {
  active: "Extended (Active)",
  refunded: "Extended (Refunded)",
  cancelled: "Extended (Cancelled)",
  expired: "Extended (Expired)",
};

const WARRANTY_STATUS_TONES = {
  active: "success",
  refunded: "critical",
  cancelled: "critical",
  expired: "critical",
};

function TruncatedText({ value, maxWidth = "180px", bold = false }) {
  if (!value) {
    return "—";
  }

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
        <Text as="span" fontWeight="semibold">
          {value}
        </Text>
      ) : (
        value
      )}
    </span>
  );
}

function DetailField({ label, value, isDate = false }) {
  const displayValue = isDate ? formatDate(value) : value || "—";

  return (
    <div>
      <div style={SECTION_LABEL_STYLE}>{label}</div>
      <Text as="p">{displayValue}</Text>
    </div>
  );
}

function getWarrantyStatus(item) {
  return item.extended_warranty_status || "";
}

function getWarrantyLabel(item) {
  const status = getWarrantyStatus(item);
  return WARRANTY_STATUS_LABELS[status] || "Standard";
}

function getWarrantyTone(item) {
  const status = getWarrantyStatus(item);
  return WARRANTY_STATUS_TONES[status] || "info";
}

function getPurchaseLabel(purchaseType) {
  return purchaseType === SHOPIFY_PURCHASE
    ? "Shopify Purchase"
    : EXTERNAL_PURCHASE_LABEL;
}

function getPurchaseTone(purchaseType) {
  return purchaseType === SHOPIFY_PURCHASE ? "success" : "info";
}

function getOrderNumber(item) {
  return item.order_number || "—";
}

function csvEscape(value) {
  const stringValue = value == null ? "" : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function buildQueryParams({
  page,
  searchQuery = "",
  warrantyTypeFilter = ALL_FILTER,
  purchaseTypeFilter = ALL_FILTER,
}) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_SIZE),
    sort: "created_at",
    order: "desc",
  });

  if (searchQuery) {
    params.set("q", searchQuery);
  }

  if (warrantyTypeFilter !== ALL_FILTER) {
    params.set("warrantyType", warrantyTypeFilter);
  }

  if (purchaseTypeFilter !== ALL_FILTER) {
    params.set("purchaseType", purchaseTypeFilter);
  }

  return params;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || "Request failed");
  }

  return json;
}

function getPaginationMeta(pagination = {}) {
  return {
    total: pagination.total || 0,
    totalPages: pagination.totalPages || 1,
    hasNextPage: Boolean(pagination.hasNextPage),
    hasPreviousPage: Boolean(pagination.hasPreviousPage),
  };
}

async function fetchRegisteredProducts(filters) {
  const params = buildQueryParams(filters);
  return fetchJson(`${REGISTERED_PRODUCTS_URL}?${params.toString()}`);
}

async function fetchAllRegisteredProducts(filters) {
  const allProducts = [];
  let currentPage = 1;
  let totalPages = 1;

  while (currentPage <= totalPages) {
    const response = await fetchRegisteredProducts({
      ...filters,
      page: currentPage,
    });

    allProducts.push(...(response.data || []));
    totalPages = response.pagination?.totalPages || 1;
    currentPage += 1;
  }

  return allProducts;
}

function downloadCsv(filename, rows) {
  if (!rows.length) {
    return;
  }

  const csvRows = rows.map((item) =>
    [
      item.id,
      item.customer_name,
      item.product_name,
      item.serial_number,
      getPurchaseLabel(item.purchase_type),
      getOrderNumber(item),
      item.sku,
      item.customer_email,
      getWarrantyLabel(item),
      formatDate(item.warranty_end),
      formatDate(item.extended_warranty_end),
    ]
      .map(csvEscape)
      .join(","),
  );

  const csv = [CSV_HEADERS.map(csvEscape).join(","), ...csvRows].join("\r\n");
  const blob = new Blob(["\uFEFF", csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function hasActiveFilters(searchQuery, warrantyTypeFilter, purchaseTypeFilter) {
  return (
    Boolean(searchQuery) ||
    warrantyTypeFilter !== ALL_FILTER ||
    purchaseTypeFilter !== ALL_FILTER
  );
}

function DetailGrid({ fields }) {
  return (
    <Grid>
      {fields
        .filter(({ show = true }) => show)
        .map(({ label, value, isDate = false }) => (
          <Grid.Cell key={label} columnSpan={DETAIL_CELL_SPAN}>
            <DetailField label={label} value={value} isDate={isDate} />
          </Grid.Cell>
        ))}
    </Grid>
  );
}

function ProductRow({ item, index, onView, onDelete }) {
  const purchaseLabel = getPurchaseLabel(item.purchase_type);

  return (
    <IndexTable.Row
      id={String(item.id)}
      key={item.id}
      position={index}
      onClick={() => onView(item)}
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
        <Badge tone={getPurchaseTone(item.purchase_type)}>
          {purchaseLabel}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{getOrderNumber(item)}</IndexTable.Cell>
      <IndexTable.Cell>{item.sku || "—"}</IndexTable.Cell>
      <IndexTable.Cell>{item.customer_email}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={getWarrantyTone(item)}>{getWarrantyLabel(item)}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{formatDate(item.warranty_end)}</IndexTable.Cell>
      <IndexTable.Cell>
        {formatDate(item.extended_warranty_end)}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <div
          className="wa-row-actions"
          style={{ display: "flex", gap: 8 }}
          onClick={(event) => event.stopPropagation()}
        >
          <Button size="micro" onClick={() => onView(item)}>
            View
          </Button>
          <Button tone="critical" size="micro" onClick={() => onDelete(item)}>
            Delete
          </Button>
        </div>
      </IndexTable.Cell>
    </IndexTable.Row>
  );
}

function ProductDetails({ product }) {
  const registrationFields = [
    { label: "Warranty Record ID", value: String(product.id) },
    {
      label: "Order Number",
      value: product.order_number,
      show: product.purchase_type !== EXTERNAL_PURCHASE_LABEL,
    },
    { label: "Serial Number", value: product.serial_number },
    { label: "SKU", value: product.sku },
    { label: "Product Name", value: product.product_name },
    { label: "Product Variant", value: product.product_variant },
    { label: "Purchase Type", value: product.purchase_type },
    {
      label: "Retailer Name",
      value: product.retailer_name,
      show: product.purchase_type === EXTERNAL_PURCHASE_LABEL,
    },
    { label: "Warranty Type", value: product.warranty_type },
    { label: "Purchase Date", value: product.purchase_date, isDate: true },
    {
      label: "Registration Date",
      value: product.registration_date,
      isDate: true,
    },
  ];

  const customerFields = [
    { label: "Customer Name", value: product.customer_name },
    { label: "Email", value: product.customer_email },
    { label: "Shopify Customer ID", value: product.shopify_customer_id },
  ];

  const warrantyFields = [
    {
      label: "Standard Warranty Start",
      value: product.warranty_start,
      isDate: true,
    },
    {
      label: "Standard Warranty End",
      value: product.warranty_end,
      isDate: true,
    },
    {
      label: "Extended Warranty Start",
      value: product.extended_warranty_start,
      isDate: true,
    },
    {
      label: "Extended Warranty End",
      value: product.extended_warranty_end,
      isDate: true,
    },
    { label: "Refund Status", value: product.refund_status },
  ];

  return (
    <LegacyStack vertical spacing="loose">
      <Card title="Registration Information" sectioned>
        <DetailGrid fields={registrationFields} />
      </Card>
      <Card title="Customer Information" sectioned>
        <DetailGrid fields={customerFields} />
      </Card>
      <Card title="Warranty Information" sectioned>
        <DetailGrid fields={warrantyFields} />
      </Card>
    </LegacyStack>
  );
}

/**
 * Renders the registered-products table and detail modal used to review each
 * customer's warranty registration history.
 */
export default function RegisteredProductsTable() {
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [warrantyTypeFilter, setWarrantyTypeFilter] = useState(ALL_FILTER);
  const [purchaseTypeFilter, setPurchaseTypeFilter] = useState(ALL_FILTER);
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
  const [exporting, setExporting] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [productDetail, setProductDetail] = useState(null);

  const closeDeleteModal = useCallback(() => {
    setDeleteModalOpen(false);
    setSelectedProduct(null);
  }, []);

  const closeDetailModal = useCallback(() => {
    setDetailOpen(false);
    setProductDetail(null);
  }, []);

  const refreshProducts = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadProducts = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetchRegisteredProducts({
          page,
          searchQuery,
          warrantyTypeFilter,
          purchaseTypeFilter,
        });

        if (cancelled) {
          return;
        }

        setProducts(response.data || []);
        setPaginationMeta(getPaginationMeta(response.pagination));

        if (response.pagination?.page && response.pagination.page !== page) {
          setPage(response.pagination.page);
        }
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        const message =
          requestError.message || "Failed to load registered products";
        setError(message);
        setProducts([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadProducts();

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
    setWarrantyTypeFilter(ALL_FILTER);
    setPurchaseTypeFilter(ALL_FILTER);
    setPage(1);
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
    setPage(1);
  };

  const handleDeleteClick = (product) => {
    setSelectedProduct(product);
    setDeleteModalOpen(true);
  };

  const handleDeleteProduct = async () => {
    if (!selectedProduct) {
      return;
    }

    try {
      setDeleteLoading(true);

      const data = await fetchJson(
        `${REGISTERED_PRODUCTS_URL}/${selectedProduct.id}`,
        { method: "DELETE" },
      );

      if (!data.success) {
        throw new Error(data.error || "Failed to delete product");
      }

      toast.showSuccess("Registered product deleted");
      closeDeleteModal();

      if (detailOpen && productDetail?.id === selectedProduct.id) {
        closeDetailModal();
      }

      refreshProducts();
    } catch (requestError) {
      toast.showError(requestError.message || "Failed to delete product");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      setExporting(true);

      const allProducts = await fetchAllRegisteredProducts({
        page: 1,
        searchQuery,
        warrantyTypeFilter,
        purchaseTypeFilter,
      });

      if (!allProducts.length) {
        toast.showError("No registered products to export");
        return;
      }

      const date = new Date().toISOString().slice(0, 10);
      downloadCsv(`registered-products-${date}.csv`, allProducts);
      toast.showSuccess(`${allProducts.length} registered product(s) exported`);
    } catch (requestError) {
      toast.showError(
        requestError.message || "Failed to export registered products",
      );
    } finally {
      setExporting(false);
    }
  };

  const openRegistrationDetails = async (product) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setProductDetail(null);

    try {
      const response = await fetchJson(
        `${REGISTERED_PRODUCTS_URL}/${product.id}`,
      );

      if (!response.success) {
        throw new Error(response.error || "Failed to load product details");
      }

      setProductDetail(response.data);
    } catch (requestError) {
      toast.showError(
        requestError.message || "Failed to load product details",
      );
      closeDetailModal();
    } finally {
      setDetailLoading(false);
    }
  };

  const showPagination =
    !loading && !error && paginationMeta.totalPages > 1;
  const filtersActive = hasActiveFilters(
    searchQuery,
    warrantyTypeFilter,
    purchaseTypeFilter,
  );

  return (
    <>
      <Page
        title="Registered Products"
        fullWidth
        primaryAction={{
          content: "Export CSV",
          onAction: handleExportCsv,
          loading: exporting,
          disabled: loading || Boolean(error) || paginationMeta.total === 0,
        }}
      >
        <Layout>
          <Layout.Section>
            <LegacyCard sectioned>
              <Text as="p" variant="bodySm" tone="subdued">
                Search by name, email, serial no., SKU, product name, or
                warranty record ID. To search by order number, use the{" "}
                <strong>#</strong> prefix — e.g. <strong>#1082</strong>.
              </Text>

              <div
                style={{
                  marginTop: 16,
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: 240 }}>
                  <TextField
                    label="Search"
                    labelHidden
                    value={searchInput}
                    onChange={setSearchInput}
                    placeholder="Search registered products..."
                    autoComplete="off"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        runSearch();
                      }
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
                    onChange={(value) => {
                      setWarrantyTypeFilter(value);
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
                    onChange={(value) => {
                      setPurchaseTypeFilter(value);
                      setPage(1);
                    }}
                  />
                </div>

                {filtersActive ? (
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
                  <Button onClick={refreshProducts}>Retry</Button>
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
                <div
                  className="wa-registered-products-table"
                  style={{ overflowX: "auto" }}
                >
                  <IndexTable
                    resourceName={{
                      singular: "product",
                      plural: "products",
                    }}
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
                      <ProductRow
                        key={item.id}
                        item={item}
                        index={index}
                        onView={openRegistrationDetails}
                        onDelete={handleDeleteClick}
                      />
                    ))}
                  </IndexTable>

                  <div
                    className="wa-pagination-bar"
                    style={{ padding: 16 }}
                  >
                    <Text as="p" tone="subdued">
                      {paginationMeta.total} result
                      {paginationMeta.total === 1 ? "" : "s"}
                    </Text>

                    {showPagination ? (
                      <Pagination
                        hasPrevious={paginationMeta.hasPreviousPage}
                        onPrevious={() =>
                          setPage((currentPage) =>
                            Math.max(1, currentPage - 1),
                          )
                        }
                        hasNext={paginationMeta.hasNextPage}
                        onNext={() => setPage((currentPage) => currentPage + 1)}
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
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: 40,
              }}
            >
              <Spinner
                accessibilityLabel="Loading registration details"
                size="large"
              />
            </div>
          ) : productDetail ? (
            <ProductDetails product={productDetail} />
          ) : null}
        </Modal.Section>
      </Modal>

      <Modal
        open={deleteModalOpen}
        onClose={closeDeleteModal}
        title="Delete Registered Product"
        primaryAction={{
          content: "Delete",
          destructive: true,
          loading: deleteLoading,
          onAction: handleDeleteProduct,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: closeDeleteModal },
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
