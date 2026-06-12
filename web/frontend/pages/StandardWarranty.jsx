// app/routes/app.warranty.jsx

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
  } from "@shopify/polaris";
  import { useEffect, useState } from "react";
  import { useToast } from "../hooks/useToast.js";
  import LoadingPanel from "../components/LoadingPanel.jsx";
  
  export default function WarrantyAdmin() {
    const toast = useToast();
    const [tab, setTab] = useState(0);
  
    // CONFIG (MONTHS)
    const [durations, setDurations] = useState([]);
    const [newDurationMonths, setNewDurationMonths] = useState("");
  
    // PRODUCTS
    const [products, setProducts] = useState([]);
    const [cursor, setCursor] = useState(null);
    const [hasNextPage, setHasNextPage] = useState(false);
  
    // UI
    const [loading, setLoading] = useState(false);
    const [productsLoaded, setProductsLoaded] = useState(false);
    const [error, setError] = useState(null);
  
    // MODAL
    const [modalOpen, setModalOpen] = useState(false);
    const [modalProductIds, setModalProductIds] = useState([]);
    const [selectedDuration, setSelectedDuration] = useState("");
  
    /* ---------------- LOADERS ---------------- */
  
    const loadDurations = async () => {
      try {
        const r = await fetch("/app/standard-warranty/durations");
        const data = await r.json();
        setDurations(Array.isArray(data) ? data : []);
      } catch {
        setDurations([]);
      }
    };
  
    const loadProducts = async (loadMore = false) => {
      setLoading(true);
      setError(null);
  
      try {
        const r = await fetch(
          `/app/standard-warranty/products${loadMore && cursor ? `?cursor=${cursor}` : ""}`
        );
  
        if (!r.ok) throw new Error();
  
        const data = await r.json();
        const safeProducts = Array.isArray(data.products) ? data.products : [];
  
        setProducts(prev =>
          loadMore ? [...prev, ...safeProducts] : safeProducts
        );
  
        setCursor(data.nextCursor || null);
        setHasNextPage(Boolean(data.hasNextPage));
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
      if (tab === 1) loadProducts();
    }, [tab]);
  
    /* ---------------- INDEX TABLE ---------------- */
  
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
        const r = await fetch("/app/standard-warranty/bulk", {
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
        loadProducts();
      } catch (err) {
        toast.showError(err.message || "Failed to save warranty");
      }
    };
  
    /* ---------------- UI ---------------- */
  
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
  
        {/* CONFIG TAB */}
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
              primary
              onClick={async () => {
                if (!newDurationMonths) return;
  
                await fetch("/app/standard-warranty/durations", {
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
  
        {/* PRODUCTS TAB */}
        {tab === 1 && (
          <LegacyCard>
            {loading && !productsLoaded ? (
              <LoadingPanel label="Loading products..." />
            ) : (
              <>
            {selectedResources.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Button primary onClick={openBulkModal}>
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
                    <Badge status={p.status === "ACTIVE" ? "success" : "critical"}>
                      {p.status}
                    </Badge>
                  </IndexTable.Cell>
  
                  <IndexTable.Cell>{p.inventory}</IndexTable.Cell>
                  <IndexTable.Cell>{p.category}</IndexTable.Cell>
  
                  <IndexTable.Cell>
                    <Button size="slim" onClick={() => openSingleModal(p)}>
                      {/* {p.duration ? `${p.duration} months` : "Set"} */}
                      {p.duration != null
                          ? (p.duration === 0 ? "N/A" : `${p.duration} months`)
                          : "Set"
                      }
                    </Button>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
  
            {hasNextPage && (
              <Button fullWidth loading={loading} onClick={() => loadProducts(true)}>
                Load more
              </Button>
            )}
              </>
            )}
          </LegacyCard>
        )}
  
        {/* MODAL */}
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