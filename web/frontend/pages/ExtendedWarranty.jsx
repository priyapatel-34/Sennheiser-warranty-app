import {
  Page,
  Tabs,
  LegacyCard,
  TextField,
  Button,
  IndexTable,
  Modal,
  Badge,
  Text,
  Pagination,
  EmptyState,
  useIndexResourceState,
  Select,
} from "@shopify/polaris";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import LoadingPanel from "../components/LoadingPanel.jsx";
import ExtendedWarrantyRefundsTab from "../components/ExtendedWarrantyRefundsTab.jsx";
import { formatMoney } from "../utils/formatMoney.js";

const API_BASE = "/app/extended-warranty";
const PAGE_SIZE = 25;

const WARRANTY_PRICING_TYPE_OPTIONS = [
  { label: "Amount", value: "amount" },
  { label: "Percentage", value: "percentage" },
];

const PRICE_BADGE_OPTIONS = [
  { label: "None", value: "" },
  { label: "Most Popular", value: "most_popular" },
  { label: "Best Seller", value: "best_seller" },
  { label: "Recommended", value: "recommended" },
  { label: "Limited Offer", value: "limited_offer" },
];

const styles = {
  stack: (gap = 16) => ({
    display: "flex",
    flexDirection: "column",
    gap,
  }),
  row: (gap = 12, align = "center") => ({
    display: "flex",
    flexDirection: "row",
    alignItems: align,
    gap,
    flexWrap: "wrap",
  }),
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: 16,
  },
  infoBanner: {
    background: "#f1f8ff",
    border: "1px solid #b3d4f5",
    borderRadius: 8,
    padding: "12px 16px",
    color: "#1a5276",
    fontSize: 14,
  },
  sectionDivider: {
    borderTop: "1px solid #e1e3e5",
    margin: "16px 0",
  },
  cardSection: {
    padding: "16px 20px",
  },
  cardSectionBorder: {
    padding: "16px 20px",
    borderBottom: "1px solid #e1e3e5",
  },
  settingsSection: {
    padding: "20px 0",
    borderBottom: "1px solid #e1e3e5",
  },
  settingsSectionLast: {
    padding: "20px 0 0",
  },
};

function countConfiguredPlans(product) {
  if (typeof product?.configuredPlanCount === "number") {
    return product.configuredPlanCount;
  }

  const activeDurations = new Set();
  for (const variant of product.variants || []) {
    for (const plan of variant.warrantyPlans || []) {
      if (plan.status && plan.status !== "active") continue;
      if (Number(plan.price) <= 0) continue;
      activeDurations.add(plan.durationMonths);
    }
  }
  return activeDurations.size;
}

export default function ExtendedWarrantyAdmin() {
  const toast = useToast();
  const [tab, setTab] = useState(0);
  const prevTabRef = useRef(0);

  const [durations, setDurations] = useState([]);
  const [newDuration, setNewDuration] = useState("");
  const [durationsLoading, setDurationsLoading] = useState(true);

  const [products, setProducts] = useState([]);
  const [currency, setCurrency] = useState(null);
  const [productSearchInput, setProductSearchInput] = useState("");
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const [cursorStack, setCursorStack] = useState([null]);
  const [paginationMeta, setPaginationMeta] = useState({
    total: 0,
    totalPages: 1,
    hasNextPage: false,
  });

  const [settings, setSettings] = useState({
    termsUrl: "",
    coverageText: "",
    extendedWarrantyPurchaseDays: "",
    warrantyPricingType: "amount",
    expiryReminderConfigs: [],
  });
  const [warrantyPricingType, setWarrantyPricingType] = useState("amount");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [configureProducts, setConfigureProducts] = useState([]);
  const [configureMode, setConfigureMode] = useState("single");
  const [variantPricing, setVariantPricing] = useState({});
  const [bulkDurationPricing, setBulkDurationPricing] = useState({});

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(products, {
    resourceIDResolver: (p) => p.id,
  });

  const resetProductsTabState = useCallback(() => {
    setProductSearchInput("");
    setProductSearchQuery("");
    setPage(1);
    setCursorStack([null]);
    setProductsLoaded(false);
    setModalOpen(false);
    setConfigureProducts([]);
    setVariantPricing({});
    setBulkDurationPricing({});
    clearSelection();
  }, [clearSelection]);

  const loadDurations = async () => {
    setDurationsLoading(true);
    try {
      const r = await fetch(`${API_BASE}/durations`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setDurations(Array.isArray(data) ? data : []);
    } catch {
      toast.showError("Unable to load durations");
      setDurations([]);
    } finally {
      setDurationsLoading(false);
    }
  };

  const loadProducts = async ({
    targetPage = page,
    search = productSearchQuery,
    jumpLast = false,
  } = {}) => {
    setProductsLoading(true);
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
      if (data.currency) setCurrency(data.currency);
      if (data.warrantyPricingType) {
        setWarrantyPricingType(data.warrantyPricingType);
      }

      const meta = data.pagination || {};
      setPaginationMeta({
        total: meta.total || 0,
        totalPages: meta.totalPages || 1,
        hasNextPage: Boolean(meta.hasNextPage),
      });

      if (meta.page) setPage(meta.page);

      if (data.nextCursor && meta.page) {
        setCursorStack((prev) => {
          const next = [...prev];
          next[meta.page] = data.nextCursor;
          return next;
        });
      }

      setProductsLoaded(true);
    } catch {
      toast.showError("Unable to load products");
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  };

  const loadSettings = async () => {
    setSettingsLoading(true);
    try {
      const r = await fetch(`${API_BASE}/settings`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      const s = data.settings || {};
      setSettings({
        termsUrl: s.termsUrl || "",
        coverageText: s.coverageText || "",
        extendedWarrantyPurchaseDays:
          s.extendedWarrantyPurchaseDays == null
            ? ""
            : String(s.extendedWarrantyPurchaseDays),
        warrantyPricingType: s.warrantyPricingType || "amount",
        expiryReminderConfigs: (s.expiryReminderConfigs || []).map((entry) => ({
          reminderDays: (entry.reminderDays || []).map(String),
        })),
      });
      setWarrantyPricingType(s.warrantyPricingType || "amount");
    } catch {
      toast.showError("Unable to load settings");
    } finally {
      setSettingsLoading(false);
    }
  };

  useEffect(() => {
    loadDurations();
  }, []);

  useEffect(() => {
    if (tab === 3) loadSettings();

    if (tab !== 1) {
      prevTabRef.current = tab;
      return;
    }

    const enteringProductsTab = prevTabRef.current !== 1;
    prevTabRef.current = tab;

    if (enteringProductsTab) {
      resetProductsTabState();
      loadProducts({ targetPage: 1, search: "" });
    } else {
      loadProducts({ targetPage: page, search: productSearchQuery });
    }

    fetch(`${API_BASE}/settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const pricingType = data?.settings?.warrantyPricingType;
        if (pricingType) setWarrantyPricingType(pricingType);
      })
      .catch(() => {});
  }, [tab, page, productSearchQuery, resetProductsTabState]);

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

  const goToFirstPage = () => setPage(1);
  const goToPreviousPage = () => setPage((p) => Math.max(1, p - 1));
  const goToNextPage = () => setPage((p) => p + 1);
  const goToLastPage = () =>
    loadProducts({ jumpLast: true, search: productSearchQuery });

  const addDuration = async () => {
    const duration = Number(newDuration);
    if (!duration || duration % 12 !== 0) {
      toast.showError("Enter duration in multiples of 12 months");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/durations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months: duration }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "Failed");
      }
      setNewDuration("");
      toast.showSuccess("Duration added");
      loadDurations();
    } catch (err) {
      toast.showError(err.message || "Failed to add duration");
    } finally {
      setSaving(false);
    }
  };

  const deleteDuration = async (id) => {
    if (!window.confirm("Delete this duration option?")) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/durations/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      toast.showSuccess("Duration deleted");
      loadDurations();
    } catch {
      toast.showError("Failed to delete duration");
    } finally {
      setSaving(false);
    }
  };

  const openConfigureModal = (targets, mode) => {
    if (!durations.length) {
      toast.showError("Add durations first");
      return;
    }
    setConfigureProducts(targets);
    setConfigureMode(mode);
    if (mode === "single" && targets.length === 1) {
      const product = targets[0];
      const vp = {};
      durations.forEach((d) => {
        (product.variants || []).forEach((v) => {
          if (!vp[v.id]) vp[v.id] = {};
          const existing = (v.warrantyPlans || []).find(
            (p) => p.durationMonths === d.durationMonths
          );
          vp[v.id][d.durationMonths] = existing ? existing.price : "";
        });
      });
      setVariantPricing(vp);
    } else {
      const bulk = {};
      durations.forEach((d) => { bulk[d.durationMonths] = ""; });
      setBulkDurationPricing(bulk);
    }
    setModalOpen(true);
  };

  const buildMappings = (product, isBulk) => {
    const mappings = [];
    (product.variants || []).forEach((variant) => {
      durations.forEach((d) => {
        const months = d.durationMonths;
        const priceValue = isBulk
          ? bulkDurationPricing[months]
          : variantPricing[variant.id]?.[months];
        const existing = (variant.warrantyPlans || []).find(
          (p) => p.durationMonths === months
        );
        if (priceValue === "" || priceValue == null) {
          if (existing) {
            mappings.push({
              variantId: variant.id,
              durationMonths: months,
              planName: existing.planName,
              price: 0,
              currency,
              status: "active",
            });
          }
          return;
        }
        mappings.push({
          variantId: variant.id,
          durationMonths: months,
          planName: d.planName,
          price: Number(priceValue),
          currency,
          status: "active",
        });
      });
    });
    return mappings;
  };

  const updateDurationBadge = async (durationId, merchandisingBadge) => {
    try {
      const r = await fetch(`${API_BASE}/durations/${durationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchandisingBadge }),
      });
      if (!r.ok) throw new Error();
      setDurations((prev) =>
        prev.map((d) =>
          d.id === durationId ? { ...d, merchandisingBadge } : d
        )
      );
      toast.showSuccess("Plan badge updated");
    } catch {
      toast.showError("Failed to update plan badge");
    }
  };

  const isPercentagePricing = warrantyPricingType === "percentage";
  const priceFieldPlaceholder = isPercentagePricing
    ? "Enter Percentage"
    : "Enter Amount";
  const priceFieldHelp = isPercentagePricing
    ? "Percentage of product variant price (e.g. 10 for 10%)"
    : currency
      ? `Amount in ${currency}`
      : undefined;

  const validatePriceInput = (value) => {
    if (value === "" || value == null) return true;
    const num = Number(value);
    if (!Number.isFinite(num)) return false;
    if (isPercentagePricing) {
      return num > 0 && num <= 100;
    }
    return num >= 0;
  };

  const savePricing = async () => {
    const allValues = configureMode === "bulk"
      ? Object.values(bulkDurationPricing)
      : Object.values(variantPricing).flatMap((variantMap) =>
          Object.values(variantMap || {})
        );

    if (allValues.some((value) => value !== "" && value != null && !validatePriceInput(value))) {
      toast.showError(
        isPercentagePricing
          ? "Each percentage must be greater than 0 and at most 100"
          : "Each amount must be greater than or equal to 0"
      );
      return;
    }

    setSaving(true);
    try {
      const payload =
        configureProducts.length === 1
          ? {
              products: [
                {
                  productId: configureProducts[0].id,
                  mappings: buildMappings(
                    configureProducts[0],
                    configureMode === "bulk"
                  ),
                },
              ],
            }
          : {
              products: configureProducts
                .map((product) => ({
                  productId: product.id,
                  mappings: buildMappings(product, configureMode === "bulk"),
                }))
                .filter((item) => item.mappings.length > 0),
            };

      const r = await fetch(`${API_BASE}/plans/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Failed to save pricing");

      if (data.errors?.length) {
        toast.showError(
          `Saved ${data.saved} products. ${data.errors.length} failed.`
        );
      } else {
        toast.showSuccess(`Pricing saved for ${data.saved} product(s)`);
      }

      setModalOpen(false);
      clearSelection();
      loadProducts({ targetPage: page, search: productSearchQuery });
    } catch (err) {
      toast.showError(err.message || "Failed to save pricing");
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const expiryReminderConfigs = (settings.expiryReminderConfigs || [])
        .map((entry) => ({
          reminderDays: (entry.reminderDays || [])
            .map((d) => Number(d))
            .filter((d) => Number.isInteger(d) && d > 0),
        }))
        .filter((entry) => entry.reminderDays.length);

      const r = await fetch(`${API_BASE}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termsUrl: settings.termsUrl,
          coverageText: settings.coverageText,
          extendedWarrantyPurchaseDays:
            settings.extendedWarrantyPurchaseDays === ""
              ? null
              : Number(settings.extendedWarrantyPurchaseDays),
          warrantyPricingType: settings.warrantyPricingType,
          expiryReminderConfigs,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Failed to save settings");
      toast.showSuccess("Settings saved");
      setWarrantyPricingType(settings.warrantyPricingType || "amount");
      loadSettings();
    } catch (err) {
      toast.showError(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const addExpiryReminderDay = (configIndex) => {
    setSettings((p) => {
      const next = [...(p.expiryReminderConfigs || [])];
      next[configIndex] = {
        ...next[configIndex],
        reminderDays: [...(next[configIndex].reminderDays || []), ""],
      };
      return { ...p, expiryReminderConfigs: next };
    });
  };

  const updateExpiryReminderDay = (configIndex, dayIndex, value) => {
    setSettings((p) => {
      const next = [...(p.expiryReminderConfigs || [])];
      const days = [...(next[configIndex].reminderDays || [])];
      days[dayIndex] = value;
      next[configIndex] = { ...next[configIndex], reminderDays: days };
      return { ...p, expiryReminderConfigs: next };
    });
  };

  const removeExpiryReminderDay = (configIndex, dayIndex) => {
    setSettings((p) => {
      const next = [...(p.expiryReminderConfigs || [])];
      const days = (next[configIndex].reminderDays || []).filter(
        (_, i) => i !== dayIndex
      );
      next[configIndex] = { ...next[configIndex], reminderDays: days };
      return { ...p, expiryReminderConfigs: next };
    });
  };

  const selectedProducts = products.filter((p) =>
    selectedResources.includes(p.id)
  );

  const modalTitle =
    configureMode === "bulk"
      ? `Extended warranty pricing — ${configureProducts.length} products`
      : `Extended warranty — ${configureProducts[0]?.title || ""}`;

  const showPagination =
    productsLoaded && !productsLoading && paginationMeta.totalPages > 1;

  return (
    <Page
      title="Extended Warranty"
      subtitle={
        tab === 3
          ? "Manage store-wide extended warranty rules, content, and customer reminders."
          : undefined
      }
      primaryAction={
        tab === 3 && !settingsLoading
          ? {
              content: "Save settings",
              onAction: saveSettings,
              loading: saving,
            }
          : undefined
      }
    >
      <Tabs
        tabs={[
          { id: "durations", content: "Durations" },
          { id: "products", content: "Products & Pricing" },
          { id: "refunds", content: "Refund Requests" },
          { id: "settings", content: "Store Settings" },
        ]}
        selected={tab}
        onSelect={setTab}
      />

      {/* ── TAB 0: Durations ── */}
      {tab === 0 && (
        <LegacyCard>
          {durationsLoading ? (
            <LoadingPanel label="Loading durations..." />
          ) : (
            <>
              <LegacyCard sectioned>
                <div style={styles.stack(16)}>
                  <Text as="h2" variant="headingMd">
                    Add new duration
                  </Text>
                  <div style={{ maxWidth: 320 }}>
                    <TextField
                      label="Duration (months)"
                      type="number"
                      value={newDuration}
                      onChange={setNewDuration}
                      placeholder="e.g. 12, 24, 36"
                      helpText="Must be a multiple of 12 months"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <Button variant="primary" onClick={addDuration} loading={saving}>
                      Add duration
                    </Button>
                  </div>
                </div>
              </LegacyCard>

              {durations.length === 0 ? (
                <EmptyState heading="No durations configured" image="">
                  <p>Add +1 Year, +2 Year, or custom multiples of 12 months.</p>
                </EmptyState>
              ) : (
                <IndexTable
                  resourceName={{ singular: "duration", plural: "durations" }}
                  itemCount={durations.length}
                  headings={[
                    { title: "Plan name" },
                    { title: "Years" },
                    { title: "Months" },
                    { title: "Price badge" },
                    { title: "Actions" },
                  ]}
                  selectable={false}
                >
                  {durations.map((d, i) => (
                    <IndexTable.Row id={String(d.id)} key={d.id} position={i}>
                      <IndexTable.Cell>
                        <Badge>{d.planName}</Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{d.durationYears}</IndexTable.Cell>
                      <IndexTable.Cell>{d.durationMonths}</IndexTable.Cell>
                      <IndexTable.Cell>
                        <div style={{ minWidth: 160 }}>
                          <Select
                            label="Price badge"
                            labelHidden
                            options={PRICE_BADGE_OPTIONS}
                            value={d.merchandisingBadge || ""}
                            onChange={(v) => updateDurationBadge(d.id, v)}
                          />
                        </div>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Button
                          tone="critical"
                          size="slim"
                          onClick={() => deleteDuration(d.id)}
                        >
                          Delete
                        </Button>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </>
          )}
        </LegacyCard>
      )}

      {/* ── TAB 1: Products & Pricing ── */}
      {tab === 1 && (
        <LegacyCard>
          {productsLoading && !productsLoaded ? (
            <LoadingPanel label="Loading products..." />
          ) : (
            <>
              {selectedResources.length > 0 && (
                <div
                  style={{
                    ...styles.row(12, "center"),
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    background: "#f1f8ff",
                    borderBottom: "1px solid #b3d4f5",
                  }}
                >
                  <Text as="span" tone="subdued">
                    {selectedResources.length} product
                    {selectedResources.length !== 1 ? "s" : ""} selected
                  </Text>
                  <Button
                    variant="primary"
                    onClick={() => openConfigureModal(selectedProducts, "bulk")}
                  >
                    Set pricing for {selectedResources.length} products
                  </Button>
                </div>
              )}

              <div
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid #e1e3e5",
                }}
              >
                <TextField
                  label="Search products"
                  labelHidden
                  value={productSearchInput}
                  onChange={setProductSearchInput}
                  placeholder="Search by product name or SKU…"
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={clearProductSearch}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runProductSearch();
                  }}
                  connectedRight={
                    <Button variant="primary" onClick={runProductSearch}>
                      Search
                    </Button>
                  }
                />
              </div>

              {productsLoading ? (
                <LoadingPanel label="Searching products..." />
              ) : products.length === 0 ? (
                <EmptyState heading="No products found" image="">
                  <p>
                    {productSearchQuery
                      ? "Try a different search term."
                      : "No products available."}
                  </p>
                </EmptyState>
              ) : (
                <>
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
                      { title: "Variants" },
                      { title: "Plans configured" },
                      { title: "Pricing" },
                    ]}
                  >
                    {products.map((product, index) => {
                      const planCount = countConfiguredPlans(product);
                      return (
                        <IndexTable.Row
                          id={product.id}
                          key={product.id}
                          selected={selectedResources.includes(product.id)}
                          position={index}
                        >
                          <IndexTable.Cell>
                            <div
                              style={{
                                maxWidth: 250,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                              title={product.title}
                            >
                              <Text as="span" fontWeight="semibold">
                                {product.title}
                              </Text>
                            </div>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge
                              tone={
                                product.status === "ACTIVE" ? "success" : "warning"
                              }
                            >
                              {product.status}
                            </Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {product.inventory ?? "—"}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {product.category || "—"}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {(product.variants || []).length}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {planCount > 0 ? (
                              <Badge tone="success">{planCount} plans</Badge>
                            ) : (
                              <Badge tone="attention">None</Badge>
                            )}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Button
                              size="slim"
                              onClick={() =>
                                openConfigureModal([product], "single")
                              }
                            >
                              {planCount ? "Edit pricing" : "Set pricing"}
                            </Button>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      );
                    })}
                  </IndexTable>

                  <div
                    style={{
                      ...styles.row(12, "center"),
                      justifyContent: "space-between",
                      padding: "12px 16px",
                      borderTop: "1px solid #e1e3e5",
                    }}
                  >
                    <Text as="p" tone="subdued">
                      {paginationMeta.total} product
                      {paginationMeta.total === 1 ? "" : "s"}
                      {productSearchQuery
                        ? ` matching "${productSearchQuery}"`
                        : ""}
                      {showPagination
                        ? ` · Page ${page} of ${paginationMeta.totalPages}`
                        : ""}
                    </Text>

                    {showPagination && (
                      <div style={styles.row(8, "center")}>
                        <Button
                          size="slim"
                          disabled={page <= 1}
                          onClick={goToFirstPage}
                        >
                          First
                        </Button>
                        <Pagination
                          hasPrevious={page > 1}
                          onPrevious={goToPreviousPage}
                          hasNext={paginationMeta.hasNextPage}
                          onNext={goToNextPage}
                          label={`Page ${page} of ${paginationMeta.totalPages}`}
                        />
                        <Button
                          size="slim"
                          disabled={page >= paginationMeta.totalPages}
                          onClick={goToLastPage}
                        >
                          Last
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </LegacyCard>
      )}

      {/* ── TAB 2: Refunds ── */}
      {tab === 2 && <ExtendedWarrantyRefundsTab />}

      {/* ── TAB 3: Store Settings ── */}
      {tab === 3 && (
        <LegacyCard>
          {settingsLoading ? (
            <LoadingPanel label="Loading settings..." />
          ) : (
            <div style={{ padding: "4px 20px 20px" }}>
              <div style={{ ...styles.settingsSection, paddingTop: 16 }}>
                <div style={styles.stack(4)}>
                  <Text as="h2" variant="headingMd">
                    Warranty pricing type
                  </Text>
                  <Text as="p" tone="subdued">
                    Choose whether extended warranty is sold at a fixed price or
                    as a percentage of the product price.
                  </Text>
                </div>
                <div style={{ marginTop: 16, maxWidth: 360 }}>
                  <Select
                    label="Warranty pricing type"
                    options={WARRANTY_PRICING_TYPE_OPTIONS}
                    value={settings.warrantyPricingType}
                    onChange={(v) =>
                      setSettings((p) => ({ ...p, warrantyPricingType: v }))
                    }
                    helpText="Amount uses fixed prices. Percentage calculates warranty price from the product variant price."
                  />
                </div>
              </div>

              <div style={styles.settingsSection}>
                <div style={styles.stack(4)}>
                  <Text as="h2" variant="headingMd">
                    Content &amp; legal
                  </Text>
                  <Text as="p" tone="subdued">
                    Shown to customers on the extended warranty offer screen.
                  </Text>
                </div>
                <div style={{ ...styles.stack(16), marginTop: 16 }}>
                  <TextField
                    label="Terms & Conditions URL"
                    value={settings.termsUrl}
                    onChange={(v) =>
                      setSettings((p) => ({ ...p, termsUrl: v }))
                    }
                    autoComplete="off"
                    placeholder="https://yourstore.com/warranty-terms"
                  />
                  <TextField
                    label="Coverage summary"
                    helpText="Brief description of what the extended warranty covers."
                    value={settings.coverageText}
                    onChange={(v) =>
                      setSettings((p) => ({ ...p, coverageText: v }))
                    }
                    multiline={5}
                    autoComplete="off"
                    placeholder="Describe what the extended warranty covers…"
                  />
                </div>
              </div>

              <div style={styles.settingsSection}>
                <div style={styles.stack(4)}>
                  <Text as="h2" variant="headingMd">
                    Purchase window
                  </Text>
                  <Text as="p" tone="subdued">
                    How long after product registration customers can buy
                    extended warranty.
                  </Text>
                </div>
                <div style={{ marginTop: 16, maxWidth: 360 }}>
                  <TextField
                    label="Days after registration to allow purchase"
                    type="number"
                    value={settings.extendedWarrantyPurchaseDays}
                    onChange={(v) =>
                      setSettings((p) => ({
                        ...p,
                        extendedWarrantyPurchaseDays: v,
                      }))
                    }
                    autoComplete="off"
                    placeholder="e.g. 90"
                    helpText="Leave empty for no time limit."
                  />
                </div>
              </div>

              <div style={styles.settingsSectionLast}>
                <div style={styles.stack(4)}>
                  <Text as="h2" variant="headingMd">
                    Expiry reminder emails
                  </Text>
                  <Text as="p" tone="subdued">
                    Send reminders this many days before the purchase window
                    closes.
                  </Text>
                </div>

                <div style={{ marginTop: 16 }}>
                  {(settings.expiryReminderConfigs || []).length === 0 ? (
                    <div style={styles.infoBanner}>
                      No reminder schedules configured. Add reminder days when
                      a schedule is available to notify customers before the
                      purchase window closes.
                    </div>
                  ) : (
                    <div style={styles.stack(12)}>
                      {(settings.expiryReminderConfigs || []).map(
                        (entry, configIndex) => (
                          <div
                            key={`reminder-${configIndex}`}
                            style={{
                              border: "1px solid #e1e3e5",
                              borderRadius: 8,
                              padding: "12px 14px",
                            }}
                          >
                            <div
                              style={{
                                ...styles.row(8, "center"),
                                flexWrap: "wrap",
                              }}
                            >
                              {(entry.reminderDays || []).map((day, dayIndex) => (
                                <div
                                  key={`reminder-day-${configIndex}-${dayIndex}`}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 4,
                                    background: "#f6f6f7",
                                    border: "1px solid #c9cccf",
                                    borderRadius: 6,
                                    padding: "3px 4px 3px 8px",
                                  }}
                                >
                                  <input
                                    type="number"
                                    value={day}
                                    min={1}
                                    onChange={(e) =>
                                      updateExpiryReminderDay(
                                        configIndex,
                                        dayIndex,
                                        e.target.value
                                      )
                                    }
                                    style={{
                                      width: 48,
                                      border: "none",
                                      background: "transparent",
                                      fontSize: 13,
                                      fontFamily: "inherit",
                                      outline: "none",
                                      padding: 0,
                                      MozAppearance: "textfield",
                                    }}
                                  />
                                  <Text
                                    as="span"
                                    variant="bodySm"
                                    tone="subdued"
                                  >
                                    days
                                  </Text>
                                  <button
                                    disabled={
                                      (entry.reminderDays || []).length <= 1
                                    }
                                    onClick={() =>
                                      removeExpiryReminderDay(
                                        configIndex,
                                        dayIndex
                                      )
                                    }
                                    style={{
                                      marginLeft: 2,
                                      background: "none",
                                      border: "none",
                                      cursor:
                                        (entry.reminderDays || []).length <= 1
                                          ? "not-allowed"
                                          : "pointer",
                                      color:
                                        (entry.reminderDays || []).length <= 1
                                          ? "#c9cccf"
                                          : "#d72c0d",
                                      fontSize: 14,
                                      lineHeight: 1,
                                      padding: "0 2px",
                                    }}
                                    title="Remove"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              <Button
                                size="slim"
                                onClick={() => addExpiryReminderDay(configIndex)}
                              >
                                + Add day
                              </Button>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </LegacyCard>
      )}

      {/* ── Pricing Modal ── */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modalTitle}
        primaryAction={{
          content: "Save pricing",
          onAction: savePricing,
          loading: saving,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setModalOpen(false) },
        ]}
        large
      >
        <Modal.Section>
          {configureMode === "bulk" ? (
            <div style={styles.stack(16)}>
              <div style={styles.infoBanner}>
                {isPercentagePricing
                  ? "Enter a percentage for each duration. It applies to all variants of each selected product. Leave a field empty to skip that duration."
                  : "Prices apply to all variants of each selected product. Leave a field empty to skip that duration."}
              </div>
              <div style={styles.grid2}>
                {durations.map((d) => (
                  <TextField
                    key={d.durationMonths}
                    label={`${d.planName} (${d.durationMonths} months)`}
                    type="number"
                    value={bulkDurationPricing[d.durationMonths] || ""}
                    onChange={(v) =>
                      setBulkDurationPricing((p) => ({
                        ...p,
                        [d.durationMonths]: v,
                      }))
                    }
                    autoComplete="off"
                    helpText={priceFieldHelp}
                    placeholder={priceFieldPlaceholder}
                    suffix={isPercentagePricing ? "%" : undefined}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div style={styles.stack(0)}>
              {(configureProducts[0]?.variants || []).map((variant, vIdx) => (
                <div key={variant.id}>
                  {vIdx > 0 && (
                    <div style={styles.sectionDivider} />
                  )}
                  <div
                    style={{
                      ...styles.stack(12),
                      paddingTop: vIdx > 0 ? 16 : 0,
                    }}
                  >
                    <div style={styles.stack(2)}>
                      <Text as="h4" variant="headingSm">
                        {variant.name || variant.title}
                      </Text>
                      {variant.sku && (
                        <Text as="p" tone="subdued" variant="bodySm">
                          SKU: {variant.sku}
                          {variant.price != null && !isPercentagePricing
                            ? ` · ${formatMoney(variant.price, currency)}`
                            : variant.price != null && isPercentagePricing
                              ? ` · Product price: ${formatMoney(variant.price, currency)}`
                              : ""}
                        </Text>
                      )}
                    </div>
                    <div style={styles.grid2}>
                      {durations.map((d) => (
                        <TextField
                          key={`${variant.id}-${d.durationMonths}`}
                          label={d.planName}
                          type="number"
                          value={
                            variantPricing[variant.id]?.[d.durationMonths] || ""
                          }
                          onChange={(v) =>
                            setVariantPricing((p) => ({
                              ...p,
                              [variant.id]: {
                                ...p[variant.id],
                                [d.durationMonths]: v,
                              },
                            }))
                          }
                          autoComplete="off"
                          helpText={priceFieldHelp}
                          placeholder={priceFieldPlaceholder}
                          suffix={isPercentagePricing ? "%" : undefined}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}
