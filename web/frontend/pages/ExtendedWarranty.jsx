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
  Checkbox,
  useIndexResourceState,
  EmptyState,
} from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import LoadingPanel from "../components/LoadingPanel.jsx";

const API_BASE = "/app/extended-warranty";

function countConfiguredPlans(product) {
  return (product.variants || []).reduce(
    (sum, v) => sum + (v.warrantyPlans || []).length,
    0
  );
}

export default function ExtendedWarrantyAdmin() {
  const toast = useToast();
  const [tab, setTab] = useState(0);

  const [durations, setDurations] = useState([]);
  const [newDuration, setNewDuration] = useState("");
  const [durationsLoading, setDurationsLoading] = useState(true);

  const [products, setProducts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [currency, setCurrency] = useState(null);
  const [productSearch, setProductSearch] = useState("");
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsLoaded, setProductsLoaded] = useState(false);

  const [settings, setSettings] = useState({
    enabled: true,
    termsUrl: "",
    coverageText: "",
  });
  const [settingsLoading, setSettingsLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [configureProducts, setConfigureProducts] = useState([]);
  const [configureMode, setConfigureMode] = useState("single");
  const [variantPricing, setVariantPricing] = useState({});
  const [bulkDurationPricing, setBulkDurationPricing] = useState({});

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p => p.title?.toLowerCase().includes(q));
  }, [products, productSearch]);

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(filteredProducts, {
    resourceIDResolver: p => p.id,
  });

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

  const loadProducts = async (loadMore = false) => {
    setProductsLoading(true);
    try {
      const url = `${API_BASE}/products${
        loadMore && cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
      }`;
      const r = await fetch(url);
      if (!r.ok) throw new Error();
      const data = await r.json();
      const safeProducts = Array.isArray(data.products) ? data.products : [];
      setProducts(prev =>
        loadMore ? [...prev, ...safeProducts] : safeProducts
      );
      setCursor(data.nextCursor || null);
      setHasNextPage(Boolean(data.hasNextPage));
      if (data.currency) setCurrency(data.currency);
      setProductsLoaded(true);
    } catch {
      toast.showError("Unable to load products");
      if (!loadMore) setProducts([]);
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
        enabled: Boolean(s.enabled ?? true),
        termsUrl: s.terms_url || "",
        coverageText: s.coverage_text || "",
      });
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
    if (tab === 1 && !productsLoaded) loadProducts();
    if (tab === 2) loadSettings();
  }, [tab]);

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

  const deleteDuration = async id => {
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
      durations.forEach(d => {
        (product.variants || []).forEach(v => {
          if (!vp[v.id]) vp[v.id] = {};
          const existing = (v.warrantyPlans || []).find(
            p => p.durationMonths === d.durationMonths
          );
          vp[v.id][d.durationMonths] = existing ? existing.price : "";
        });
      });
      setVariantPricing(vp);
    } else {
      const bulk = {};
      durations.forEach(d => {
        bulk[d.durationMonths] = "";
      });
      setBulkDurationPricing(bulk);
    }
    setModalOpen(true);
  };

  const buildMappings = (product, isBulk) => {
    const mappings = [];
    (product.variants || []).forEach(variant => {
      durations.forEach(d => {
        const months = d.durationMonths;
        const priceValue = isBulk
          ? bulkDurationPricing[months]
          : variantPricing[variant.id]?.[months];
        const existing = (variant.warrantyPlans || []).find(
          p => p.durationMonths === months
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

  const savePricing = async () => {
    setSaving(true);
    try {
      for (const product of configureProducts) {
        const mappings = buildMappings(
          product,
          configureMode === "bulk"
        );
        if (!mappings.length) continue;
        const r = await fetch(`${API_BASE}/plans`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: product.id, mappings }),
        });
        if (!r.ok) {
          const err = await r.json();
          throw new Error(err.error || `Failed for ${product.title}`);
        }
      }
      setModalOpen(false);
      clearSelection();
      toast.showSuccess("Pricing saved");
      loadProducts();
    } catch (err) {
      toast.showError(err.message || "Failed to save pricing");
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!r.ok) throw new Error();
      toast.showSuccess("Settings saved");
    } catch {
      toast.showError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const selectedProducts = filteredProducts.filter(p =>
    selectedResources.includes(p.id)
  );

  const modalTitle =
    configureMode === "bulk"
      ? `Extended warranty pricing — ${configureProducts.length} products`
      : `Extended warranty — ${configureProducts[0]?.title || ""}`;

  return (
    <Page title="Extended Warranty">
      <Tabs
        tabs={[
          { id: "durations", content: "Durations" },
          { id: "products", content: "Products & Pricing" },
          { id: "settings", content: "Store Settings" },
        ]}
        selected={tab}
        onSelect={setTab}
      />

      {tab === 0 && (
        <LegacyCard>
          {durationsLoading ? (
            <LoadingPanel label="Loading durations..." />
          ) : (
            <>
              <LegacyCard sectioned>
                <TextField
                  label="Add duration (months)"
                  type="number"
                  value={newDuration}
                  onChange={setNewDuration}
                  placeholder="12, 24, 36"
                  helpText="Must be multiples of 12 months"
                  autoComplete="off"
                />
                <div style={{ marginTop: 12 }}>
                  <Button variant="primary" onClick={addDuration} loading={saving}>
                    Add duration
                  </Button>
                </div>
              </LegacyCard>

              {durations.length === 0 ? (
                <EmptyState
                  heading="No durations configured"
                  image=""
                >
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

      {tab === 1 && (
        <LegacyCard>
          {productsLoading && !productsLoaded ? (
            <LoadingPanel label="Loading products..." />
          ) : (
            <>
              {selectedResources.length > 0 && (
                <div style={{ padding: 16 }}>
                  <Button
                    variant="primary"
                    onClick={() =>
                      openConfigureModal(selectedProducts, "bulk")
                    }
                  >
                    Set pricing for {selectedResources.length} products
                  </Button>
                </div>
              )}

              <div style={{ padding: "0 16px 16px" }}>
                <TextField
                  label="Search products"
                  value={productSearch}
                  onChange={setProductSearch}
                  autoComplete="off"
                />
              </div>

              <IndexTable
                resourceName={{ singular: "product", plural: "products" }}
                itemCount={filteredProducts.length}
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
                {filteredProducts.map((product, index) => {
                  const planCount = countConfiguredPlans(product);
                  return (
                    <IndexTable.Row
                      id={product.id}
                      key={product.id}
                      selected={selectedResources.includes(product.id)}
                      position={index}
                    >
                      <IndexTable.Cell>
                        <Text as="span" fontWeight="semibold">
                          {product.title}
                        </Text>
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
                      <IndexTable.Cell>{product.inventory ?? "—"}</IndexTable.Cell>
                      <IndexTable.Cell>{product.category || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>
                        {(product.variants || []).length}
                      </IndexTable.Cell>
                      <IndexTable.Cell>{planCount}</IndexTable.Cell>
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

              {hasNextPage && (
                <Button fullWidth loading={productsLoading} onClick={() => loadProducts(true)}>
                  Load more
                </Button>
              )}
            </>
          )}
        </LegacyCard>
      )}

      {tab === 2 && (
        <LegacyCard sectioned>
          {settingsLoading ? (
            <LoadingPanel label="Loading settings..." />
          ) : (
            <>
              <Checkbox
                label="Extended warranty enabled"
                checked={settings.enabled}
                onChange={v => setSettings(p => ({ ...p, enabled: v }))}
              />
              <TextField
                label="Terms & Conditions URL"
                value={settings.termsUrl}
                onChange={v => setSettings(p => ({ ...p, termsUrl: v }))}
                autoComplete="off"
              />
              <TextField
                label="Default coverage summary (shown on offer screen)"
                value={settings.coverageText}
                onChange={v => setSettings(p => ({ ...p, coverageText: v }))}
                multiline={4}
                autoComplete="off"
              />
              <div style={{ marginTop: 16 }}>
                <Button variant="primary" onClick={saveSettings} loading={saving}>
                  Save settings
                </Button>
              </div>
            </>
          )}
        </LegacyCard>
      )}

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
            <>
              <Text as="p" tone="subdued">
                Same price applies to all variants of each selected product.
              </Text>
              {durations.map(d => (
                <TextField
                  key={d.durationMonths}
                  label={`${d.planName} (${d.durationMonths} months)`}
                  type="number"
                  value={bulkDurationPricing[d.durationMonths] || ""}
                  onChange={v =>
                    setBulkDurationPricing(p => ({
                      ...p,
                      [d.durationMonths]: v,
                    }))
                  }
                  autoComplete="off"
                  helpText={currency ? `Amount in ${currency}` : undefined}
                />
              ))}
            </>
          ) : (
            (configureProducts[0]?.variants || []).map(variant => (
              <LegacyCard key={variant.id} sectioned>
                <Text as="h4" variant="headingSm">
                  {variant.name || variant.title}
                </Text>
                {variant.sku && (
                  <Text as="p" tone="subdued" variant="bodySm">
                    SKU: {variant.sku}
                  </Text>
                )}
                {durations.map(d => (
                  <TextField
                    key={`${variant.id}-${d.durationMonths}`}
                    label={d.planName}
                    type="number"
                    value={variantPricing[variant.id]?.[d.durationMonths] || ""}
                    onChange={v =>
                      setVariantPricing(p => ({
                        ...p,
                        [variant.id]: {
                          ...p[variant.id],
                          [d.durationMonths]: v,
                        },
                      }))
                    }
                    autoComplete="off"
                    helpText={currency ? `Amount in ${currency}` : undefined}
                  />
                ))}
              </LegacyCard>
            ))
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}
