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
    Banner,
    Spinner,
} from "@shopify/polaris";
import { useEffect, useState } from "react";

const API_BASE = "/app/extended-warranty";

export default function ExtendedWarrantyAdmin() {
    const [tab, setTab] = useState(0);

    // Configuration
    const [durations, setDurations] = useState([]);
    const [newDuration, setNewDuration] = useState("");

    // Products
    const [products, setProducts] = useState([]);
    const [cursor, setCursor] = useState(null);
    const [hasNextPage, setHasNextPage] = useState(false);
    const [currency, setCurrency] = useState("USD");

    // UI
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    // Modal
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [variantPricing, setVariantPricing] = useState({});

    const loadDurations = async () => {
        try {
            const r = await fetch(`${API_BASE}/durations`);
            if (!r.ok) throw new Error();
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
        } catch {
            setError("Unable to load products");
            if (!loadMore) setProducts([]);
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

    const addDuration = async () => {
        if (!newDuration) return;

        const duration = Number(newDuration);
        if (duration % 12 !== 0) {
            setError("Please enter duration in multiples of 12 months (12, 24, 36)");
            return;
        }

        try {
            const r = await fetch(`${API_BASE}/durations`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ months: duration }),
            });
            if (!r.ok) {
                const err = await r.json();
                throw new Error(err.error || "Failed to add duration");
            }
            setNewDuration("");
            setError(null);
            loadDurations();
        } catch (err) {
            setError(err.message || "Failed to add duration");
        }
    };

    const openProductModal = product => {
        setSelectedProduct(product);

        const variantsPricing = {};
        const durationMonthsList = durations.map(d => d.durationMonths);

        (product.variants || []).forEach(variant => {
            variantsPricing[variant.id] = {};

            durationMonthsList.forEach(months => {
                const existingPlan = (variant.warrantyPlans || []).find(
                    p => p.durationMonths === months
                );
                variantsPricing[variant.id][months] = existingPlan
                    ? existingPlan.price
                    : "";
            });
        });

        setVariantPricing(variantsPricing);
        setModalOpen(true);
    };

    const saveWarrantyPricing = async () => {
        if (!selectedProduct) return;

        setSaving(true);
        setError(null);

        try {
            const mappings = [];

            (selectedProduct.variants || []).forEach(variant => {
                const pricesByDuration = variantPricing[variant.id] || {};
                const durationMonthsList = durations.map(d => d.durationMonths);

                durationMonthsList.forEach(months => {
                    const priceValue = pricesByDuration[months];
                    const existingPlan = (variant.warrantyPlans || []).find(
                        p => p.durationMonths === months
                    );
                    const durationConfig = durations.find(
                        d => d.durationMonths === months
                    );

                    if (
                        priceValue === "" ||
                        priceValue === null ||
                        priceValue === undefined
                    ) {
                        if (existingPlan) {
                            mappings.push({
                                variantId: variant.id,
                                durationMonths: months,
                                planName: existingPlan.planName,
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
                        planName:
                            durationConfig?.planName || `+${months / 12} Year`,
                        price: Number(priceValue),
                        currency,
                        status: "active",
                    });
                });
            });

            const r = await fetch(`${API_BASE}/plans`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    productId: selectedProduct.id,
                    mappings,
                }),
            });

            if (!r.ok) {
                const err = await r.json();
                throw new Error(err.error || "Failed to save pricing");
            }

            setModalOpen(false);
            loadProducts();
        } catch (err) {
            setError(err.message || "Failed to save warranty pricing");
        } finally {
            setSaving(false);
        }
    };

    const currencyPrefix = currency === "INR" ? "₹" : currency === "EUR" ? "€" : "$";

    return (
        <Page title="Extended Warranty">
            <Tabs
                tabs={[
                    { id: "config", content: "Configuration" },
                    { id: "products", content: "Products" },
                ]}
                selected={tab}
                onSelect={setTab}
            />

            {error && (
                <Banner tone="critical" title="Error" onDismiss={() => setError(null)}>
                    {error}
                </Banner>
            )}

            {/* CONFIGURATION TAB */}
            {tab === 0 && (
                <LegacyCard sectioned>
                    <TextField
                        label="Add Extended Warranty Duration (Months)"
                        type="number"
                        value={newDuration}
                        onChange={setNewDuration}
                        placeholder="12, 24, 36"
                        autoComplete="off"
                    />

                    <div style={{ marginTop: 12 }}>
                        <Button variant="primary" onClick={addDuration}>
                            Add Duration
                        </Button>
                    </div>

                    <div style={{ marginTop: 20 }}>
                        <Text as="p" variant="bodyMd">
                            <strong>Available Durations:</strong>
                        </Text>

                        <div
                            style={{
                                marginTop: 10,
                                display: "flex",
                                gap: "10px",
                                flexWrap: "wrap",
                            }}
                        >
                            {durations.length === 0 ? (
                                <Text as="span" tone="subdued">
                                    None configured
                                </Text>
                            ) : (
                                durations.map(duration => (
                                    <Badge key={duration.durationMonths}>
                                        {duration.planName} ({duration.durationMonths} Months)
                                    </Badge>
                                ))
                            )}
                        </div>
                    </div>
                </LegacyCard>
            )}

            {/* PRODUCTS TAB */}
            {tab === 1 && (
                <LegacyCard>
                    {loading && <Spinner accessibilityLabel="Loading products" />}

                    <IndexTable
                        resourceName={{
                            singular: "product",
                            plural: "products",
                        }}
                        itemCount={products.length}
                        headings={[
                            { title: "Product" },
                            { title: "Status" },
                            { title: "Inventory" },
                            { title: "Category" },
                            { title: "Variants" },
                            { title: "Extended Warranty" },
                        ]}
                        selectable={false}
                    >
                        {products.map((product, index) => (
                            <IndexTable.Row
                                id={product.id}
                                key={product.id}
                                position={index}
                            >
                                <IndexTable.Cell>
                                    <Text
                                        as="span"
                                        variant="bodyMd"
                                        fontWeight="semibold"
                                    >
                                        {product.title}
                                    </Text>
                                </IndexTable.Cell>

                                <IndexTable.Cell>
                                    <Badge
                                        tone={
                                            product.status === "ACTIVE"
                                                ? "success"
                                                : "warning"
                                        }
                                    >
                                        {product.status}
                                    </Badge>
                                </IndexTable.Cell>

                                <IndexTable.Cell>
                                    {product.inventory}
                                </IndexTable.Cell>

                                <IndexTable.Cell>
                                    {product.category}
                                </IndexTable.Cell>

                                <IndexTable.Cell>
                                    {(product.variants || []).length}
                                </IndexTable.Cell>

                                <IndexTable.Cell>
                                    <Button
                                        size="slim"
                                        onClick={() => openProductModal(product)}
                                    >
                                        Configure
                                    </Button>
                                </IndexTable.Cell>
                            </IndexTable.Row>
                        ))}
                    </IndexTable>

                    {hasNextPage && !loading && (
                        <Button fullWidth onClick={() => loadProducts(true)}>
                            Load more
                        </Button>
                    )}
                </LegacyCard>
            )}

            {/* CONFIGURE PRODUCT MODAL */}
            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title={`Extended Warranty - ${selectedProduct?.title || ""}`}
                primaryAction={{
                    content: "Save",
                    onAction: saveWarrantyPricing,
                    loading: saving,
                }}
                secondaryActions={[
                    {
                        content: "Cancel",
                        onAction: () => setModalOpen(false),
                    },
                ]}
            >
                <Modal.Section>
                    {durations.length === 0 ? (
                        <Banner tone="warning">
                            Please add extended warranty durations in Configuration first.
                        </Banner>
                    ) : (
                        <>
                            <Text as="p" variant="bodyMd" tone="subdued">
                                Set per-variant extended warranty pricing.
                            </Text>

                            {(selectedProduct?.variants || []).map(variant => (
                                <LegacyCard key={variant.id} sectioned>
                                    <Text as="h4" variant="headingSm">
                                        {variant.name || variant.title}
                                    </Text>
                                    {variant.sku && (
                                        <Text as="p" variant="bodySm" tone="subdued">
                                            SKU: {variant.sku} · Product price: {variant.price}{" "}
                                            {currency}
                                        </Text>
                                    )}

                                    <div style={{ marginTop: 15 }}>
                                        {durations.map(duration => (
                                            <div
                                                key={duration.durationMonths}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "20px",
                                                    marginBottom: "12px",
                                                }}
                                            >
                                                <div style={{ width: "140px" }}>
                                                    <Text as="span">
                                                        {duration.planName}
                                                    </Text>
                                                </div>

                                                <div style={{ flex: 1 }}>
                                                    <TextField
                                                        labelHidden
                                                        label="Price"
                                                        type="number"
                                                        prefix={currencyPrefix}
                                                        autoComplete="off"
                                                        value={
                                                            variantPricing[variant.id]?.[
                                                                duration.durationMonths
                                                            ] || ""
                                                        }
                                                        onChange={value =>
                                                            setVariantPricing(prev => ({
                                                                ...prev,
                                                                [variant.id]: {
                                                                    ...prev[variant.id],
                                                                    [duration.durationMonths]:
                                                                        value,
                                                                },
                                                            }))
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </LegacyCard>
                            ))}

                            {(!selectedProduct?.variants ||
                                selectedProduct.variants.length === 0) && (
                                <Banner tone="info">
                                    This product has no variants in Shopify.
                                </Banner>
                            )}
                        </>
                    )}
                </Modal.Section>
            </Modal>
        </Page>
    );
}
