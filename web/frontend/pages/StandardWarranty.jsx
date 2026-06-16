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

export default function WarrantyAdmin() {
  const toast = useToast();
  const [tab, setTab] = useState(0);

  const [durations, setDurations] = useState([]);
  const [newDurationMonths, setNewDurationMonths] = useState("");

  const [products, setProducts] = useState([]);
  const [productSearchInput, setProductSearchInput] = useState("");
  const [productSearchQuery, setProductSearchQuery] = useState("");
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

  const loadDurations = async () => {
    try {
      const r = await fetch(`${API_BASE}/durations`);
      const data = await r.json();
      setDurations(Array.isArray(data) ? data : []);
    } catch {
      setDurations([]);
    }
  };

  const loadProducts = async ({
    targetPage = page,
    search = productSearchQuery,
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
      loadProducts({ targetPage: page, search: productSearchQuery });
    }
  }, [tab, page, productSearchQuery]);

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

  const runProductSearch = () => {
    setPage(1);
    setCursorStack([null]);
    setProductSearchQuery(productSearchInput.trim());
  };

  const clearProductSearch = () => {
    setProductSearchInput("");
    setProductSearchQuery("");
    setPage(1);
    setCursorStack([null]);
  };

  const openSingleModal = product => {
    setModalProductIds([product.id]);
    setSelectedDuration(product.duration ? String(product.duration) : "");
    setModalOpen(true);
  };

  const openBulkModal = () => {
    setModalProductIds(selectedResources);
    setSelectedDuration("");
    setModalOpen(true);
  };

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
      loadProducts({ targetPage: page, search: productSearchQuery });
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
        <div style={{ padding: "0 0 12px" }}>
          <Text as="p" tone="critical">
            {error}
          </Text>
        </div>
      )}

      {tab === 0 && (
        <LegacyCard sectioned>
          <TextField
            label="Add warranty duration (months)"
            type="number"
            min={1}
            value={newDurationMonths}
            onChange={setNewDurationMonths}
            placeholder="e.g. 6, 12, 24"
          />

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

          <Text as="p" variant="bodyMd">
            <strong>Available Durations:</strong>{" "}
            {durations.length > 0 ? durations.join(", ") : "None"} months
          </Text>
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
                  <TextField
                    label="Search products"
                    labelHidden
                    placeholder="Search by product name or SKU"
                    value={productSearchInput}
                    onChange={setProductSearchInput}
                    clearButton
                    onClearButtonClick={clearProductSearch}
                    autoComplete="off"
                    connectedRight={
                      <Button onClick={runProductSearch}>Search</Button>
                    }
                  />
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
                  {paginationMeta.total} product
                  {paginationMeta.total === 1 ? "" : "s"}
                  {productSearchQuery ? ` matching "${productSearchQuery}"` : ""}
                  {showPagination
                    ? ` · Page ${page} of ${paginationMeta.totalPages}`
                    : ""}
                </Text>
                {showPagination ? (
                  <div gap="200" blockAlign="center">
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
