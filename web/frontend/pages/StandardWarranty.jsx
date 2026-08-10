import {
  Page,
  Tabs,
  LegacyCard,
  TextField,
  Button,
  IndexTable,
  useIndexResourceState,
  Select,
  Modal,
  Badge,
  Text,
  Pagination,
} from "@shopify/polaris";
import { useEffect, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import LoadingPanel from "../components/LoadingPanel.jsx";

const API_BASE = "/app/standard-warranty";
const PAGE_SIZE = 25;

const STATUS_FILTER_OPTIONS = [
  { label: "All statuses", value: "all" },
  { label: "Active", value: "active" },
  { label: "Draft", value: "draft" },
];

/**
 * Renders the standard-warranty admin page where merchants configure warranty
 * durations and assign them to products in bulk or one at a time.
 */
export default function WarrantyAdmin() {
  const toast = useToast();
  const [tab, setTab] = useState(0);

  const [durations, setDurations] = useState([]);
  const [newDurationMonths, setNewDurationMonths] = useState("");

  const [products, setProducts] = useState([]);
  const [productSearchInput, setProductSearchInput] = useState("");
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [cursorStack, setCursorStack] = useState([null]);
  const [paginationMeta, setPaginationMeta] = useState({
    total: 0,
    totalPages: 1,
    hasNextPage: false,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [modalProductIds, setModalProductIds] = useState([]);
  const [selectedDuration, setSelectedDuration] = useState("");

  /**
   * Fetches the configured duration list for the active shop.
   */
  const loadDurations = async () => {
    try {
      const r = await fetch(`${API_BASE}/durations`);
      const data = await r.json();
      setDurations(Array.isArray(data) ? data : []);
    } catch {
      setDurations([]);
    }
  };

  /**
   * Loads products for the warranty assignment table using the current search,
   * status filter, and pagination state.
   */
  const loadProducts = async ({
    targetPage = page,
    search = productSearchQuery,
    status = statusFilter,
    jumpLast = false,
  } = {}) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        page: String(targetPage),
      });
      if (jumpLast) {
        params.set("last", "1");
      } else {
        const cursor = targetPage > 1 ? cursorStack[targetPage - 1] : null;
        if (cursor) params.set("cursor", cursor);
      }
      if (search) params.set("q", search);
      if (status && status !== "all") params.set("status", status);

      const r = await fetch(`${API_BASE}/products?${params.toString()}`);
      if (!r.ok) throw new Error();

      const data = await r.json();
      setProducts(Array.isArray(data.products) ? data.products : []);

      const meta = data.pagination || {};
      setPaginationMeta({
        total: meta.total || 0,
        totalPages: meta.totalPages || 1,
        hasNextPage: Boolean(meta.hasNextPage),
      });

      if (meta.page) setPage(meta.page);

      if (data.nextCursor && meta.page) {
        setCursorStack(prev => {
          const next = [...prev];
          next[meta.page] = data.nextCursor;
          return next;
        });
      }

      setProductsLoaded(true);
    } catch {
      setError("Unable to load products");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDurations();
  }, []);

  useEffect(() => {
    if (tab === 1) {
      loadProducts({
        targetPage: page,
        search: productSearchQuery,
        status: statusFilter,
      });
    }
  }, [tab, page, productSearchQuery, statusFilter]);

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(products, {
    resourceIDResolver: p => p.id,
  });

  const durationOptions = durations.map(m => ({
    label: `${m} months`,
    value: String(m),
  }));
  durationOptions.unshift({ label: "N/A", value: "0" });

  /**
   * Applies the current search box contents as the active product filter.
   */
  const runProductSearch = () => {
    setPage(1);
    setCursorStack([null]);
    setProductSearchQuery(productSearchInput.trim());
  };

  /**
   * Resets the product list back to the default unfiltered state.
   */
  const clearProductSearch = () => {
    setProductSearchInput("");
    setProductSearchQuery("");
    setStatusFilter("all");
    setPage(1);
    setCursorStack([null]);
  };

  const statusFilterLabel =
    STATUS_FILTER_OPTIONS.find(option => option.value === statusFilter)?.label ||
    "All statuses";

  /**
   * Opens the warranty duration modal for one selected product.
   */
  const openSingleModal = product => {
    setModalProductIds([product.id]);
    setSelectedDuration(product.duration ? String(product.duration) : "");
    setModalOpen(true);
  };

  /**
   * Opens the bulk-edit modal so the same warranty duration can be assigned to
   * every currently selected product.
   */
  const openBulkModal = () => {
    setModalProductIds(selectedResources);
    setSelectedDuration("");
    setModalOpen(true);
  };

  /**
   * Persists the selected warranty duration to the backend for one or many
   * products.
   */
  const saveWarranty = async () => {
    try {
      const r = await fetch(`${API_BASE}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: modalProductIds,
          duration: Number(selectedDuration),
        }),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save warranty");
      }

      setModalOpen(false);
      clearSelection();
      toast.showSuccess("Standard warranty saved successfully");
      loadProducts({
        targetPage: page,
        search: productSearchQuery,
        status: statusFilter,
      });
    } catch (err) {
      toast.showError(err.message || "Failed to save warranty");
    }
  };

  const showPagination =
    productsLoaded && !loading && paginationMeta.totalPages > 1;

  return (
    <Page title="Standard Warranty">
      <Tabs
        tabs={[
          { id: "config", content: "Configuration" },
          { id: "products", content: "Products" },
        ]}
        selected={tab}
        onSelect={setTab}
      />

      {error && (
        <div className="wa-admin-section-gap">
          <Text as="p" tone="critical">
            {error}
          </Text>
        </div>
      )}

      {tab === 0 && (
        <LegacyCard sectioned>
          <div className="wa-compact-form-panel">
            <Text as="h2" variant="headingMd">
              Add warranty duration
            </Text>
            <div className="wa-compact-form-row">
              <div className="wa-compact-form-row__field">
                <TextField
                  label="Add warranty duration (months)"
                  type="number"
                  min={1}
                  value={newDurationMonths}
                  onChange={setNewDurationMonths}
                  placeholder="e.g. 6, 12, 24"
                  autoComplete="off"
                />
              </div>
              <div className="wa-compact-form-row__control">
                <Button
                  variant="primary"
                  onClick={async () => {
                    if (!newDurationMonths) return;

                    await fetch(`${API_BASE}/durations`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        months: Number(newDurationMonths),
                      }),
                    });

                    setNewDurationMonths("");
                    toast.showSuccess("Duration added");
                    loadDurations();
                  }}
                >
                  Add Duration
                </Button>
              </div>
            </div>
            <Text as="p" tone="subdued">
              <strong>Available durations:</strong>{" "}
              {durations.length > 0 ? `${durations.join(", ")} months` : "None"}
            </Text>
          </div>
        </LegacyCard>
      )}

      {tab === 1 && (
        <LegacyCard>
          {loading && !productsLoaded ? (
            <LoadingPanel label="Loading products..." />
          ) : (
            <>
              <div style={{ padding: "16px 16px 0" }}>
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    runProductSearch();
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <TextField
                        label="Search products"
                        labelHidden
                        placeholder="Search by product name or SKU"
                        value={productSearchInput}
                        onChange={setProductSearchInput}
                        clearButton
                        onClearButtonClick={() => {
                          setProductSearchInput("");
                          setProductSearchQuery("");
                          setPage(1);
                          setCursorStack([null]);
                        }}
                        autoComplete="off"
                        connectedRight={
                          <Button onClick={runProductSearch}>Search</Button>
                        }
                      />
                    </div>
                    <div style={{ minWidth: 180 }}>
                      <Select
                        label="Status"
                        labelHidden
                        options={STATUS_FILTER_OPTIONS}
                        value={statusFilter}
                        onChange={value => {
                          setPage(1);
                          setCursorStack([null]);
                          clearSelection();
                          setStatusFilter(value);
                        }}
                      />
                    </div>
                  </div>
                </form>
              </div>

              {selectedResources.length > 0 && (
                <div style={{ margin: "12px 16px" }}>
                  <Button variant="primary" onClick={openBulkModal}>
                    Set warranty for {selectedResources.length} products
                  </Button>
                </div>
              )}

              <IndexTable
                resourceName={{ singular: "product", plural: "products" }}
                itemCount={products.length}
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "Product" },
                  { title: "Status" },
                  { title: "Inventory" },
                  { title: "Category" },
                  { title: "Standard Warranty" },
                ]}
              >
                {products.map((p, index) => (
                  <IndexTable.Row
                    id={p.id}
                    key={p.id}
                    selected={selectedResources.includes(p.id)}
                    position={index}
                  >
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {p.title}
                      </Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Badge
                        tone={p.status === "ACTIVE" ? "success" : "warning"}
                      >
                        {p.status}
                      </Badge>
                    </IndexTable.Cell>

                    <IndexTable.Cell>{p.inventory ?? "—"}</IndexTable.Cell>
                    <IndexTable.Cell>{p.category || "—"}</IndexTable.Cell>

                    <IndexTable.Cell>
                      <Button size="slim" onClick={() => openSingleModal(p)}>
                        {p.duration != null
                          ? p.duration === 0
                            ? "N/A"
                            : `${p.duration} months`
                          : "Set"}
                      </Button>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>

              <div className="wa-pagination-bar" style={{ padding: 16 }}>
                <Text as="p" tone="subdued">
                  {paginationMeta.total} product
                  {paginationMeta.total === 1 ? "" : "s"}
                  {statusFilter !== "all" ? ` · ${statusFilterLabel}` : ""}
                  {productSearchQuery ? ` matching "${productSearchQuery}"` : ""}
                  {showPagination
                    ? ` · Page ${page} of ${paginationMeta.totalPages}`
                    : ""}
                </Text>
                {showPagination ? (
                  <div className="wa-pagination-bar__controls">
                    <Button disabled={page <= 1} onClick={() => setPage(1)}>
                      First
                    </Button>
                    <Pagination
                      hasPrevious={page > 1}
                      onPrevious={() => setPage(p => Math.max(1, p - 1))}
                      hasNext={paginationMeta.hasNextPage}
                      onNext={() => setPage(p => p + 1)}
                      label={`Page ${page} of ${paginationMeta.totalPages}`}
                    />
                    <Button
                      disabled={page >= paginationMeta.totalPages}
                      onClick={() =>
                        loadProducts({
                          jumpLast: true,
                          search: productSearchQuery,
                          status: statusFilter,
                        })
                      }
                    >
                      Last
                    </Button>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </LegacyCard>
      )}

      {modalOpen && (
        <Modal
          open
          title="Set Standard Warranty"
          primaryAction={{ content: "Save", onAction: saveWarranty }}
          onClose={() => setModalOpen(false)}
        >
          <Modal.Section>
            <Select
              label="Warranty duration (months)"
              options={durationOptions}
              value={selectedDuration}
              onChange={setSelectedDuration}
              placeholder="Select duration"
            />
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
