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
    Checkbox,
} from "@shopify/polaris";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../hooks/useToast.js";
import LoadingPanel from "../components/LoadingPanel.jsx";
import ExtendedWarrantyRefundsTab from "../components/ExtendedWarrantyRefundsTab.jsx";
import { formatMoney } from "../utils/formatMoney.js";
import {
    buildRemovePricingModalContent,
    toNumericShopifyId,
} from "../utils/warrantyPricingDelete.js";

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

/**
 * Counts how many warranty plan mappings are already configured for a product
 * so the admin grid can show completion state at a glance.
 */
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

/**
 * Renders the extended-warranty admin screen where merchants manage durations,
 * plan mappings, pricing rules, and reminder settings.
 */
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
    const [productStatusFilter, setProductStatusFilter] = useState("");
    const [productsLoading, setProductsLoading] = useState(false);
    const [productsLoaded, setProductsLoaded] = useState(false);
    const [page, setPage] = useState(1);
    const [pageCursorHistory, setPageCursorHistory] = useState([null]);
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
        extendedWarrantyOfferEnabled: true,
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
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmLoading, setConfirmLoading] = useState(false);
    const confirmInFlightRef = useRef(false);
    const [addProductsOpen, setAddProductsOpen] = useState(false);
    const [addSearchInput, setAddSearchInput] = useState("");
    const [addSearchQuery, setAddSearchQuery] = useState("");
    const [addProducts, setAddProducts] = useState([]);
    const [addProductsLoading, setAddProductsLoading] = useState(false);
    const [addPage, setAddPage] = useState(1);
    const [addPageCursorHistory, setAddPageCursorHistory] = useState([null]);
    const [addHasNextPage, setAddHasNextPage] = useState(false);

    const {
        selectedResources,
        allResourcesSelected,
        handleSelectionChange,
        clearSelection,
    } = useIndexResourceState(products, {
        resourceIDResolver: (p) => p.id,
    });

    const {
        selectedResources: addSelectedResources,
        allResourcesSelected: addAllResourcesSelected,
        handleSelectionChange: handleAddSelectionChange,
        clearSelection: clearAddSelection,
    } = useIndexResourceState(addProducts, {
        resourceIDResolver: (p) => p.id,
    });

    // Ref to suppress the extra useEffect run triggered by resetProductsTabState
    // state updates when first entering the products tab.
    const suppressNextProductsLoadRef = useRef(false);

    /**
     * Clears the product search and pagination state when the admin needs to
     * refresh the extended-warranty product list.
     */
    const resetProductsTabState = useCallback(() => {
        setProductSearchInput("");
        setProductSearchQuery("");
        setProductStatusFilter("");
        setPage(1);
        setPageCursorHistory([null]);
        setProductsLoaded(false);
        setModalOpen(false);
        setConfigureProducts([]);
        setVariantPricing({});
        setBulkDurationPricing({});
        clearSelection();
    }, [clearSelection]);

    /**
     * Loads the configured extended-warranty duration rows for the current shop.
     */
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
        status = productStatusFilter,
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
                const cursor = targetPage > 1 ? pageCursorHistory[targetPage - 1] : null;
                if (cursor) params.set("cursor", cursor);
            }
            if (search) params.set("q", search);
            if (status) params.set("status", status);

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
                setPageCursorHistory((prev) => {
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

    /**
     * Loads the shop-level extended-warranty settings and reminder-day config.
     */
    const loadSettings = async () => {
        setSettingsLoading(true);
        try {
            const r = await fetch(`${API_BASE}/settings`, {
                credentials: "include",
            });
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
                extendedWarrantyOfferEnabled:
                    s.extendedWarrantyOfferEnabled === undefined
                        ? true
                        : Boolean(s.extendedWarrantyOfferEnabled),
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
            // Suppress the follow-up effect run caused by resetProductsTabState
            // clearing page/search/status state (prevents duplicate load).
            suppressNextProductsLoadRef.current = true;
            resetProductsTabState();
            loadProducts({ targetPage: 1, search: "", status: "" });
            return;
        }

        if (suppressNextProductsLoadRef.current) {
            suppressNextProductsLoadRef.current = false;
            return;
        }

        loadProducts({ targetPage: page, search: productSearchQuery, status: productStatusFilter });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, page, productSearchQuery, productStatusFilter, resetProductsTabState]);

    /**
     * Commits the current search text into the active query so the list refreshes.
     */
    const runProductSearch = () => {
        setPage(1);
        setPageCursorHistory([null]);
        setProductSearchQuery(productSearchInput.trim());
    };

    /**
     * Resets the product search filters back to the default browse state.
     */
    const clearProductSearch = () => {
        setProductSearchInput("");
        setProductSearchQuery("");
        setPage(1);
        setPageCursorHistory([null]);
    };

    /**
     * Updates the product status filter and returns the list to the first page.
     */
    const handleStatusFilterChange = (value) => {
        setProductStatusFilter(value);
        setPage(1);
        setPageCursorHistory([null]);
    };

    const goToFirstPage = () => setPage(1);
    const goToPreviousPage = () => setPage((p) => Math.max(1, p - 1));
    const goToNextPage = () => setPage((p) => p + 1);
    const goToLastPage = () =>
        loadProducts({ jumpLast: true, search: productSearchQuery, status: productStatusFilter });

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

    const loadExcludedProducts = async ({
        targetPage = addPage,
        search = addSearchQuery,
    } = {}) => {
        setAddProductsLoading(true);
        try {
            const params = new URLSearchParams({
                limit: String(PAGE_SIZE),
                page: String(targetPage),
            });
            const cursor = targetPage > 1 ? addPageCursorHistory[targetPage - 1] : null;
            if (cursor) params.set("cursor", cursor);
            if (search) params.set("q", search);

            const r = await fetch(`${API_BASE}/products/excluded?${params.toString()}`);
            if (!r.ok) throw new Error();
            const data = await r.json();
            setAddProducts(Array.isArray(data.products) ? data.products : []);
            const meta = data.pagination || {};
            setAddHasNextPage(Boolean(meta.hasNextPage || data.hasNextPage));
            if (data.nextCursor && (meta.page || targetPage)) {
                const pageNumber = meta.page || targetPage;
                setAddPageCursorHistory((prev) => {
                    const next = [...prev];
                    next[pageNumber] = data.nextCursor;
                    return next;
                });
            }
            if (meta.page) setAddPage(meta.page);
        } catch {
            toast.showError("Unable to search products");
            setAddProducts([]);
        } finally {
            setAddProductsLoading(false);
        }
    };

    const openAddProductsModal = () => {
        setAddSearchInput("");
        setAddSearchQuery("");
        setAddPage(1);
        setAddPageCursorHistory([null]);
        setAddHasNextPage(false);
        clearAddSelection();
        setAddProductsOpen(true);
        loadExcludedProducts({ targetPage: 1, search: "" });
    };

    const runAddProductSearch = () => {
        setAddPage(1);
        setAddPageCursorHistory([null]);
        const term = addSearchInput.trim();
        setAddSearchQuery(term);
        loadExcludedProducts({ targetPage: 1, search: term });
    };

    const addSelectedExcludedProducts = async () => {
        if (!addSelectedResources.length) {
            toast.showError("Select at least one product");
            return;
        }
        setSaving(true);
        try {
            const r = await fetch(`${API_BASE}/products/overrides`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productIds: addSelectedResources }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
                throw new Error(data.error || "Failed to add products");
            }
            const addedCount = Array.isArray(data.added) ? data.added.length : 0;
            const skippedEligible = (data.skipped || []).filter(
                (item) => item.reason === "already_eligible"
            );
            if (addedCount) {
                toast.showSuccess(
                    addedCount === 1
                        ? "Product added to the eligible list"
                        : `${addedCount} products added to the eligible list`
                );
            } else if ((data.skipped || []).every((item) => item.reason === "already_added")) {
                toast.showSuccess("Selected products are already on the eligible list");
            }
            if (skippedEligible.length && addedCount) {
                toast.showError(
                    `${skippedEligible.length} product(s) were already eligible by default`
                );
            }
            setAddProductsOpen(false);
            clearAddSelection();
            await loadProducts({
                targetPage: page,
                search: productSearchQuery,
                status: productStatusFilter,
            });
        } catch (err) {
            toast.showError(err.message || "Failed to add products");
        } finally {
            setSaving(false);
        }
    };

    const confirmModalCopy = confirmAction
        ? buildRemovePricingModalContent(confirmAction)
        : null;

    const executeConfirmedAction = async () => {
        if (!confirmAction || confirmLoading || confirmInFlightRef.current) return;
        confirmInFlightRef.current = true;
        setConfirmLoading(true);
        try {
            if (confirmAction.kind === "override") {
                const productId = toNumericShopifyId(confirmAction.product?.id);
                const r = await fetch(
                    `${API_BASE}/products/overrides/${productId}`,
                    { method: "DELETE" }
                );
                const data = await r.json().catch(() => ({}));
                if (!r.ok) {
                    throw new Error(data.error || "Failed to remove product");
                }
                toast.showSuccess("Product removed from the eligible list");
                setConfirmAction(null);
                await loadProducts({
                    targetPage: page,
                    search: productSearchQuery,
                    status: productStatusFilter,
                });
                return;
            }

            const { scope, product, variant, plan } = confirmAction;
            let url;
            if (scope === "product") {
                url = `${API_BASE}/plans/product/${toNumericShopifyId(product.id)}`;
            } else if (scope === "variant") {
                url = `${API_BASE}/plans/variant/${toNumericShopifyId(variant.id)}`;
            } else {
                if (!plan?.planId) {
                    throw new Error("Pricing record not found");
                }
                url = `${API_BASE}/plans/${plan.planId}`;
            }

            const r = await fetch(url, { method: "DELETE" });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
                throw new Error(data.error || "Failed to remove pricing");
            }

            if (scope === "year") {
                setVariantPricing((previous) => ({
                    ...previous,
                    [variant.id]: {
                        ...(previous[variant.id] || {}),
                        [confirmAction.duration.durationMonths]: "",
                    },
                }));
                setConfigureProducts((previous) =>
                    previous.map((currentProduct) => ({
                        ...currentProduct,
                        variants: currentProduct.variants.map((currentVariant) => {
                            if (currentVariant.id !== variant.id) return currentVariant;
                            return {
                                ...currentVariant,
                                warrantyPlans: (currentVariant.warrantyPlans || []).filter(
                                    (currentPlan) =>
                                        Number(currentPlan.durationMonths) !==
                                        Number(confirmAction.duration.durationMonths)
                                ),
                            };
                        }),
                    }))
                );
                setProducts((previous) =>
                    previous.map((currentProduct) => {
                        if (currentProduct.id !== configureProducts[0]?.id) {
                            return currentProduct;
                        }
                        const updatedVariants = (currentProduct.variants || []).map(
                            (currentVariant) => {
                                if (currentVariant.id !== variant.id) return currentVariant;
                                return {
                                    ...currentVariant,
                                    warrantyPlans: (currentVariant.warrantyPlans || []).filter(
                                        (currentPlan) =>
                                            Number(currentPlan.durationMonths) !==
                                            Number(confirmAction.duration.durationMonths)
                                    ),
                                };
                            }
                        );
                        const activeDurations = new Set();
                        updatedVariants.forEach((currentVariant) => {
                            (currentVariant.warrantyPlans || []).forEach((currentPlan) => {
                                if (currentPlan.status && currentPlan.status !== "active") return;
                                if (Number(currentPlan.price) <= 0) return;
                                activeDurations.add(Number(currentPlan.durationMonths));
                            });
                        });
                        return {
                            ...currentProduct,
                            variants: updatedVariants,
                            configuredPlanCount: activeDurations.size,
                        };
                    })
                );
                toast.showSuccess(`${confirmAction.duration.planName} pricing removed`);
            } else if (scope === "variant") {
                setVariantPricing((previous) => ({
                    ...previous,
                    [variant.id]: {},
                }));
                setConfigureProducts((previous) =>
                    previous.map((currentProduct) => ({
                        ...currentProduct,
                        variants: currentProduct.variants.map((currentVariant) => {
                            if (currentVariant.id !== variant.id) return currentVariant;
                            return { ...currentVariant, warrantyPlans: [] };
                        }),
                    }))
                );
                toast.showSuccess(`Pricing removed for ${variant.name || variant.title}`);
                await loadProducts({
                    targetPage: page,
                    search: productSearchQuery,
                    status: productStatusFilter,
                });
            } else {
                toast.showSuccess(`All pricing removed for ${product.title}`);
                await loadProducts({
                    targetPage: page,
                    search: productSearchQuery,
                    status: productStatusFilter,
                });
            }
            setConfirmAction(null);
        } catch (err) {
            toast.showError(err.message || "Failed to remove pricing");
        } finally {
            confirmInFlightRef.current = false;
            setConfirmLoading(false);
        }
    };

    const removeProductPricing = (product) => {
        setConfirmAction({
            kind: "pricing",
            scope: "product",
            product,
        });
    };

    const removeVariantPricing = (product, variant) => {
        setConfirmAction({
            kind: "pricing",
            scope: "variant",
            product,
            variant,
        });
    };

    const removeVariantDurationPricing = (product, variant, duration) => {
        const existingPlan = (variant.warrantyPlans || []).find(
            (currentPlan) =>
                Number(currentPlan.durationMonths) === Number(duration.durationMonths)
        );
        if (!existingPlan?.planId) {
            toast.showError("Pricing record not found");
            return;
        }
        setConfirmAction({
            kind: "pricing",
            scope: "year",
            product,
            variant,
            duration,
            plan: existingPlan,
        });
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
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    termsUrl: settings.termsUrl,
                    coverageText: settings.coverageText,
                    extendedWarrantyPurchaseDays:
                        settings.extendedWarrantyPurchaseDays === ""
                            ? null
                            : Number(settings.extendedWarrantyPurchaseDays),
                    warrantyPricingType: settings.warrantyPricingType,
                    extendedWarrantyOfferEnabled: Boolean(
                        settings.extendedWarrantyOfferEnabled
                    ),
                    expiryReminderConfigs,
                }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data.error || "Failed to save settings");
            if (data.settings) {
                setSettings({
                    termsUrl: data.settings.termsUrl || "",
                    coverageText: data.settings.coverageText || "",
                    extendedWarrantyPurchaseDays:
                        data.settings.extendedWarrantyPurchaseDays == null
                            ? ""
                            : String(data.settings.extendedWarrantyPurchaseDays),
                    warrantyPricingType:
                        data.settings.warrantyPricingType || "amount",
                    extendedWarrantyOfferEnabled: Boolean(
                        data.settings.extendedWarrantyOfferEnabled
                    ),
                    expiryReminderConfigs: (
                        data.settings.expiryReminderConfigs || []
                    ).map((entry) => ({
                        reminderDays: (entry.reminderDays || []).map(String),
                    })),
                });
                setWarrantyPricingType(data.settings.warrantyPricingType || "amount");
            }
            toast.showSuccess("Settings saved");
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
                    : tab === 1
                        ? {
                            content: "Add products",
                            onAction: openAddProductsModal,
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
                <LegacyCard sectioned>
                    {durationsLoading ? (
                        <LoadingPanel label="Loading durations..." />
                    ) : (
                        <>
                            <div className="wa-compact-form-panel wa-compact-form-panel--spaced">
                                <Text as="h2" variant="headingMd">
                                    Add new duration
                                </Text>
                                <div className="wa-compact-form-row">
                                    <div className="wa-compact-form-row__field">
                                        <TextField
                                            label="Duration (months)"
                                            type="number"
                                            value={newDuration}
                                            onChange={setNewDuration}
                                            placeholder="e.g. 12, 24, 36"
                                            autoComplete="off"
                                        />
                                    </div>
                                    <div className="wa-compact-form-row__control">
                                        <Button variant="primary" onClick={addDuration} loading={saving}>
                                            Add duration
                                        </Button>
                                    </div>
                                </div>
                                <Text as="p" tone="subdued" variant="bodySm">
                                    Must be a multiple of 12 months
                                </Text>
                            </div>

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
                                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                                    <div style={{ flex: "1 1 260px", minWidth: 220 }}>
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
                                    <div style={{ minWidth: 148 }}>
                                        <Select
                                            label="Status"
                                            labelHidden
                                            options={[
                                                { label: "All statuses", value: "" },
                                                { label: "Active", value: "active" },
                                                { label: "Draft", value: "draft" },
                                            ]}
                                            value={productStatusFilter}
                                            onChange={handleStatusFilterChange}
                                        />
                                    </div>
                                </div>
                            </div>

                            {productsLoading ? (
                                <LoadingPanel label="Searching products..." />
                            ) : products.length === 0 ? (
                                <EmptyState heading="No eligible products found" image="">
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
                                                            {product.isOverride ? (
                                                                <div style={{ marginTop: 4 }}>
                                                                    <Badge>Manually added</Badge>
                                                                </div>
                                                            ) : null}
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
                                                        <div
                                                            style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: 8,
                                                                flexWrap: "wrap",
                                                            }}
                                                        >
                                                            <Button
                                                                size="slim"
                                                                onClick={() =>
                                                                    openConfigureModal([product], "single")
                                                                }
                                                            >
                                                                {planCount ? "Edit pricing" : "Set pricing"}
                                                            </Button>

                                                            {planCount > 0 && (
                                                                <Button
                                                                    size="slim"
                                                                    tone="critical"
                                                                    onClick={() => removeProductPricing(product)}
                                                                >
                                                                    Remove pricing
                                                                </Button>
                                                            )}
                                                        </div>
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
                                        Extended Warranty Offer
                                    </Text>
                                    <Text as="p" tone="subdued">
                                        Show the Extended Warranty offer screen to customers right
                                        after they complete standard warranty registration.
                                    </Text>
                                </div>
                                <div style={{ marginTop: 16 }}>
                                    <Checkbox
                                        label="Enable Extended Warranty Offer"
                                        checked={settings.extendedWarrantyOfferEnabled}
                                        onChange={(checked) =>
                                            setSettings((p) => ({
                                                ...p,
                                                extendedWarrantyOfferEnabled: checked,
                                            }))
                                        }
                                        helpText="When disabled, customers are taken straight to My Products after registering standard warranty."
                                    />
                                </div>
                            </div>

                            <div style={{ ...styles.settingsSection, paddingTop: 16 }}>
                                <div style={styles.stack(4)}>
                                    <Text as="h2" variant="headingMd">
                                        Warranty pricing type
                                    </Text>
                                    <Text as="p" tone="subdued">
                                        Choose whether extended warranty is sold at a fixed price or
                                        as a percentage of the product MSRP.
                                    </Text>
                                </div>
                                <div style={{ marginTop: 16, maxWidth: 360 }}>
                                    <Select
                                        label=""
                                        options={WARRANTY_PRICING_TYPE_OPTIONS}
                                        value={settings.warrantyPricingType}
                                        onChange={(v) =>
                                            setSettings((p) => ({ ...p, warrantyPricingType: v }))
                                        }
                                        helpText="Amount uses fixed prices and Percentage uses MSRP."

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
                                            <div style={styles.row(8, "center")}>
                                                <Text as="h4" variant="headingSm">
                                                    {variant.name || variant.title}
                                                </Text>
                                            </div>
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
                                            {durations.map((d) => {
                                                const existingPlan = (
                                                    variant.warrantyPlans || []
                                                ).find(
                                                    (plan) =>
                                                        Number(plan.durationMonths) ===
                                                        Number(d.durationMonths)
                                                );

                                                const currentPrice =
                                                    variantPricing[variant.id]?.[
                                                    d.durationMonths
                                                    ] ?? "";

                                                return (
                                                    <div
                                                        key={`${variant.id}-${d.durationMonths}`}
                                                        style={{
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            gap: 6,
                                                        }}
                                                    >
                                                        {/* Duration label + remove icon */}
                                                        <div
                                                            style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                justifyContent: "space-between",
                                                                gap: 8,
                                                            }}
                                                        >
                                                            <Text
                                                                as="span"
                                                                variant="bodyMd"
                                                                fontWeight="semibold"
                                                            >
                                                                {d.planName}
                                                            </Text>

                                                            {existingPlan?.planId && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        removeVariantDurationPricing(
                                                                            configureProducts[0],
                                                                            variant,
                                                                            d
                                                                        )
                                                                    }
                                                                    title={`Remove ${d.planName} price`}
                                                                    aria-label={`Remove ${d.planName} price`}
                                                                    style={{
                                                                        border: "none",
                                                                        background: "transparent",
                                                                        cursor: "pointer",
                                                                        padding: "2px 5px",
                                                                        margin: 0,
                                                                        color: "#8e1f0b",
                                                                        fontSize: 18,
                                                                        lineHeight: 1,
                                                                        fontWeight: 600,
                                                                        borderRadius: 4,
                                                                    }}
                                                                    onMouseEnter={(e) => {
                                                                        e.currentTarget.style.background =
                                                                            "#fce8e6";
                                                                    }}
                                                                    onMouseLeave={(e) => {
                                                                        e.currentTarget.style.background =
                                                                            "transparent";
                                                                    }}
                                                                >
                                                                    ×
                                                                </button>
                                                            )}
                                                        </div>

                                                        <TextField
                                                            label={d.planName}
                                                            labelHidden
                                                            type="number"
                                                            value={currentPrice}
                                                            onChange={(v) =>
                                                                setVariantPricing((p) => ({
                                                                    ...p,
                                                                    [variant.id]: {
                                                                        ...(p[variant.id] || {}),
                                                                        [d.durationMonths]: v,
                                                                    },
                                                                }))
                                                            }
                                                            autoComplete="off"
                                                            helpText={priceFieldHelp}
                                                            placeholder={priceFieldPlaceholder}
                                                            suffix={
                                                                isPercentagePricing
                                                                    ? "%"
                                                                    : undefined
                                                            }
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {/* <div style={styles.grid2}>
                                            {durations.map((d) => {
                                                const existingPlan = (
                                                    variant.warrantyPlans || []
                                                ).find(
                                                    (plan) =>
                                                        Number(plan.durationMonths) ===
                                                        Number(d.durationMonths)
                                                );

                                                const currentPrice =
                                                    variantPricing[variant.id]?.[
                                                    d.durationMonths
                                                    ] ?? "";

                                                return (
                                                    <div
                                                        key={`${variant.id}-${d.durationMonths}`}
                                                        style={{
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            gap: 6,
                                                        }}
                                                    >
                                                        <TextField
                                                            label={d.planName}
                                                            type="number"
                                                            value={currentPrice}
                                                            onChange={(v) =>
                                                                setVariantPricing((p) => ({
                                                                    ...p,
                                                                    [variant.id]: {
                                                                        ...(p[variant.id] || {}),
                                                                        [d.durationMonths]: v,
                                                                    },
                                                                }))
                                                            }
                                                            autoComplete="off"
                                                            helpText={priceFieldHelp}
                                                            placeholder={priceFieldPlaceholder}
                                                            suffix={
                                                                isPercentagePricing
                                                                    ? "%"
                                                                    : undefined
                                                            }
                                                        />

                                                        {existingPlan?.planId && (
                                                            <Button
                                                                size="slim"
                                                                tone="critical"
                                                                onClick={() =>
                                                                    removeVariantDurationPricing(
                                                                        configureProducts[0],
                                                                        variant,
                                                                        d
                                                                    )
                                                                }
                                                            >
                                                                Remove price
                                                            </Button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div> */}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Modal.Section>
            </Modal>

            <Modal
                open={addProductsOpen}
                onClose={() => {
                    if (saving) return;
                    setAddProductsOpen(false);
                }}
                title="Add products"
                primaryAction={{
                    content: "Add products",
                    onAction: addSelectedExcludedProducts,
                    loading: saving,
                    disabled: addSelectedResources.length === 0 || addProductsLoading,
                }}
                secondaryActions={[
                    {
                        content: "Cancel",
                        onAction: () => setAddProductsOpen(false),
                        disabled: saving,
                    },
                ]}
                large
            >
                <Modal.Section>
                    <div style={styles.stack(16)}>
                        <Text as="p" tone="subdued">
                            Search products that are excluded from the default warranty list
                            (accessories, spare parts, or products without a product type)
                            and add them explicitly.
                        </Text>
                        <TextField
                            label="Search excluded products"
                            labelHidden
                            value={addSearchInput}
                            onChange={setAddSearchInput}
                            placeholder="Search by product name or SKU…"
                            autoComplete="off"
                            clearButton
                            onClearButtonClick={() => {
                                setAddSearchInput("");
                                setAddSearchQuery("");
                                setAddPage(1);
                                setAddPageCursorHistory([null]);
                                loadExcludedProducts({ targetPage: 1, search: "" });
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") runAddProductSearch();
                            }}
                            connectedRight={
                                <Button variant="primary" onClick={runAddProductSearch}>
                                    Search
                                </Button>
                            }
                        />
                        {addProductsLoading ? (
                            <LoadingPanel label="Searching products..." />
                        ) : addProducts.length === 0 ? (
                            <EmptyState heading="No excluded products found" image="">
                                <p>
                                    {addSearchQuery
                                        ? "Try a different search term. Eligible headphones and soundbars are not shown here."
                                        : "No excluded products are available to add."}
                                </p>
                            </EmptyState>
                        ) : (
                            <>
                                <IndexTable
                                    resourceName={{ singular: "product", plural: "products" }}
                                    itemCount={addProducts.length}
                                    selectedItemsCount={
                                        addAllResourcesSelected
                                            ? "All"
                                            : addSelectedResources.length
                                    }
                                    onSelectionChange={handleAddSelectionChange}
                                    headings={[
                                        { title: "Product" },
                                        { title: "Status" },
                                        { title: "Product type" },
                                        { title: "Variants" },
                                    ]}
                                >
                                    {addProducts.map((product, index) => (
                                        <IndexTable.Row
                                            id={product.id}
                                            key={product.id}
                                            selected={addSelectedResources.includes(product.id)}
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
                                                        product.status === "ACTIVE"
                                                            ? "success"
                                                            : "warning"
                                                    }
                                                >
                                                    {product.status}
                                                </Badge>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                {product.productType || product.category || "—"}
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                {product.variantCount ??
                                                    (product.variants || []).length}
                                            </IndexTable.Cell>
                                        </IndexTable.Row>
                                    ))}
                                </IndexTable>
                                <div
                                    style={{
                                        ...styles.row(8, "center"),
                                        justifyContent: "space-between",
                                    }}
                                >
                                    <Text as="p" tone="subdued">
                                        {addSelectedResources.length} selected
                                    </Text>
                                    <Pagination
                                        hasPrevious={addPage > 1}
                                        onPrevious={() => {
                                            const nextPage = Math.max(1, addPage - 1);
                                            setAddPage(nextPage);
                                            loadExcludedProducts({
                                                targetPage: nextPage,
                                                search: addSearchQuery,
                                            });
                                        }}
                                        hasNext={addHasNextPage}
                                        onNext={() => {
                                            const nextPage = addPage + 1;
                                            setAddPage(nextPage);
                                            loadExcludedProducts({
                                                targetPage: nextPage,
                                                search: addSearchQuery,
                                            });
                                        }}
                                        label={`Page ${addPage}`}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                </Modal.Section>
            </Modal>

            <Modal
                open={Boolean(confirmAction)}
                onClose={() => {
                    if (confirmLoading) return;
                    setConfirmAction(null);
                }}
                title={confirmModalCopy?.title || "Remove pricing?"}
                primaryAction={{
                    content: confirmModalCopy?.confirmLabel || "Remove Pricing",
                    destructive: true,
                    loading: confirmLoading,
                    onAction: executeConfirmedAction,
                }}
                secondaryActions={[
                    {
                        content: "Cancel",
                        onAction: () => {
                            if (confirmLoading) return;
                            setConfirmAction(null);
                        },
                        disabled: confirmLoading,
                    },
                ]}
            >
                <Modal.Section>
                    <div style={styles.stack(8)}>
                        <Text as="p">{confirmModalCopy?.body}</Text>
                        {(confirmModalCopy?.details || []).map((line) => (
                            <Text as="p" key={line} tone="subdued">
                                {line}
                            </Text>
                        ))}
                    </div>
                </Modal.Section>
            </Modal>
        </Page>
    );
}
