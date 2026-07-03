(() => {
    const POST_REG_KEY = "warranty_post_registration_state";
    const REG_CONTEXT_KEY = "warranty_registration_context";
    const CHECKOUT_PENDING_KEY = "ew_checkout_pending";
    const MAX_AGE_MS = 2 * 60 * 60 * 1000;

    function readJson(key) {
        try {
            const raw = sessionStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function writeJson(key, value) {
        sessionStorage.setItem(key, JSON.stringify(value));
    }

    function navigateReplace(url) {
        if (!url) return;
        window.location.replace(url);
    }

    function isRegistrationFormPage() {
        return Boolean(document.getElementById("twsForm"));
    }

    function normalizeOfferResponse(data) {
        if (!data || typeof data !== "object") return null;
        if (data.eligible !== undefined) {
            const { success, ...offer } = data;
            return offer;
        }
        return data.extendedWarrantyOffer || null;
    }

    async function fetchExtendedWarrantyOffer(registerId) {
        const res = await fetch(
            `/apps/warranty/extended-warranty/offer?register_id=${encodeURIComponent(registerId)}`
        );
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "Failed to load extended warranty offer");
        }
        return normalizeOfferResponse(data);
    }

    function resolveMyProductsLink(options = {}) {
        return (
            options.myProductsLink ||
            readJson(POST_REG_KEY)?.myProductsLink ||
            readJson(CHECKOUT_PENDING_KEY)?.myProductsLink ||
            "/pages/my-products"
        );
    }

    function resolveRegisterId(options = {}) {
        if (options.registerId) return Number(options.registerId);
        const postReg = readJson(POST_REG_KEY);
        const checkoutPending = readJson(CHECKOUT_PENDING_KEY);
        const historyRegisterId = history.state?.ewRegisterId;
        return (
            postReg?.registerId ||
            checkoutPending?.registerId ||
            historyRegisterId ||
            null
        );
    }

    function replaceHistoryForOffer(registerId) {
        history.replaceState(
            {
                ...(history.state || {}),
                ewOffer: true,
                ewRegisterId: Number(registerId),
            },
            "",
            window.location.href
        );
    }

    function clearOfferHistoryState() {
        if (!history.state?.ewOffer && !history.state?.ewRegisterId) return;
        const nextState = { ...(history.state || {}) };
        delete nextState.ewOffer;
        delete nextState.ewRegisterId;
        history.replaceState(nextState, "", window.location.href);
    }

    function resetOfferFlowState() {
        sessionStorage.removeItem(POST_REG_KEY);
        sessionStorage.removeItem(CHECKOUT_PENDING_KEY);
        clearOfferHistoryState();
    }

    function redirectToMyProducts(myProductsLink, reason) {
        resetOfferFlowState();
        navigateReplace(myProductsLink);
        return { allowed: false, action: "redirected", reason };
    }

    function shouldShowExtendedWarrantyOffer(data, offer, navigation = {}) {
        return (
            Boolean(offer?.eligible) ||
            navigation.next === "extended_warranty" ||
            Boolean(data?.showExtendedWarrantyOffer)
        );
    }

    async function ensureOfferAccessAllowed(options = {}) {
        const myProductsLink = resolveMyProductsLink(options);
        const registerId = resolveRegisterId(options);
        const hasOfferContext =
            Boolean(readJson(POST_REG_KEY)) ||
            Boolean(readJson(CHECKOUT_PENDING_KEY)) ||
            Boolean(history.state?.ewOffer);

        if (!registerId) {
            return { allowed: true, action: "continue", myProductsLink };
        }

        try {
            const offer = await fetchExtendedWarrantyOffer(registerId);

            if (offer?.reason === "already_purchased" || offer?.entitlement?.status === "active") {
                if (hasOfferContext && !isRegistrationFormPage()) {
                    return redirectToMyProducts(myProductsLink, "already_purchased");
                }
                resetOfferFlowState();
                return { allowed: true, action: "continue", myProductsLink };
            }

            if (!offer?.eligible) {
                if (hasOfferContext) {
                    if (isRegistrationFormPage()) {
                        resetOfferFlowState();
                        return { allowed: true, action: "continue", myProductsLink };
                    }
                    return redirectToMyProducts(
                        myProductsLink,
                        offer.reason || "not_eligible"
                    );
                }
                return { allowed: true, action: "continue", myProductsLink, registerId };
            }

            return {
                allowed: true,
                action: "continue",
                data: offer,
                registerId,
                myProductsLink,
            };
        } catch (err) {
            console.warn("Extended warranty offer access check failed:", err.message);
            return { allowed: true, action: "continue", myProductsLink, registerId };
        }
    }

    window.WarrantyFlowState = {
        savePostRegistration(state) {
            writeJson(POST_REG_KEY, { ...state, savedAt: Date.now() });
        },

        getPostRegistration() {
            const state = readJson(POST_REG_KEY);
            if (!state?.savedAt) return null;
            if (Date.now() - state.savedAt > MAX_AGE_MS) {
                sessionStorage.removeItem(POST_REG_KEY);
                return null;
            }
            return state;
        },

        clearPostRegistration() {
            sessionStorage.removeItem(POST_REG_KEY);
        },

        markCheckoutStarted({ registerId, myProductsLink }) {
            writeJson(CHECKOUT_PENDING_KEY, {
                registerId: Number(registerId),
                myProductsLink: myProductsLink || "/pages/my-products",
                startedAt: Date.now(),
            });
            sessionStorage.removeItem(POST_REG_KEY);
            if (registerId) {
                replaceHistoryForOffer(registerId);
            }
        },

        clearCheckoutPending() {
            sessionStorage.removeItem(CHECKOUT_PENDING_KEY);
        },

        clearOfferFlowState() {
            resetOfferFlowState();
        },

        onOfferRendered(registerId) {
            if (registerId) {
                replaceHistoryForOffer(registerId);
            }
        },

        getRegistrationContext() {
            return readJson(REG_CONTEXT_KEY);
        },

        clearRegistrationContext() {
            sessionStorage.removeItem(REG_CONTEXT_KEY);
        },

        async resolveExtendedWarrantyOffer(data) {
            const registerId = data?.registrations?.[0]?.registerId;
            const navigation = data?.postRegistrationNavigation || {};
            const shouldFetchFullOffer =
                Boolean(data?.showExtendedWarrantyOffer) ||
                navigation.next === "extended_warranty";

            if (shouldFetchFullOffer && registerId) {
                try {
                    const fetched = await fetchExtendedWarrantyOffer(registerId);
                    if (fetched) return fetched;
                } catch (err) {
                    console.warn("Extended warranty offer fetch failed:", err.message);
                }
            }

            const inline = normalizeOfferResponse(data?.extendedWarrantyOffer);
            if (inline?.eligible) return inline;

            if (registerId) {
                try {
                    return await fetchExtendedWarrantyOffer(registerId);
                } catch (err) {
                    console.warn("Extended warranty offer fetch failed:", err.message);
                }
            }

            return inline || null;
        },

        async renderEligibleOffer(offer, options = {}) {
            if (!offer?.eligible || !window.ExtendedWarrantyOffer) {
                return false;
            }

            const myProductsLink = resolveMyProductsLink(options);
            const registerId = offer?.registration?.registerId;

            try {
                const rendered = window.ExtendedWarrantyOffer.renderOffer(offer, {
                    myProductsLink,
                    customerEmail: options.customerEmail || "",
                    customerName: options.customerName || "",
                    onSkip: () => {
                        resetOfferFlowState();
                        navigateReplace(myProductsLink);
                    },
                });

                if (rendered && registerId) {
                    this.onOfferRendered(registerId);
                }

                return Boolean(rendered);
            } catch (err) {
                console.error("Extended warranty offer render failed:", err);
                return false;
            }
        },

        /**
         * After standard registration:
         * - eligible EW within purchase window → show offer page
         * - purchase window expired / no offer → My Products
         */
        async handlePostRegistrationNavigation(data, options = {}) {
            const {
                myProductsLink = "/pages/my-products",
                customerEmail = "",
                customerName = "",
                redirectDelayMs = 4500,
            } = options;

            const navigation = data?.postRegistrationNavigation || {};
            let offer = await this.resolveExtendedWarrantyOffer(data);

            if (
                shouldShowExtendedWarrantyOffer(data, offer, navigation) &&
                (!offer?.registration || !offer?.plans?.length)
            ) {
                const registerId = data?.registrations?.[0]?.registerId;
                if (registerId) {
                    try {
                        offer = await fetchExtendedWarrantyOffer(registerId);
                    } catch (err) {
                        console.warn("Extended warranty offer refetch failed:", err.message);
                    }
                }
            }

            if (shouldShowExtendedWarrantyOffer(data, offer, navigation) && offer?.eligible) {
                let rendered = await this.renderEligibleOffer(offer, {
                    myProductsLink,
                    customerEmail,
                    customerName,
                });

                if (!rendered && data?.registrations?.[0]?.registerId) {
                    try {
                        const refreshed = await fetchExtendedWarrantyOffer(
                            data.registrations[0].registerId
                        );
                        if (refreshed?.eligible) {
                            offer = refreshed;
                            rendered = await this.renderEligibleOffer(offer, {
                                myProductsLink,
                                customerEmail,
                                customerName,
                            });
                        }
                    } catch (err) {
                        console.warn("Extended warranty offer retry failed:", err.message);
                    }
                }

                if (rendered) {
                    return { shownOffer: true };
                }
            }

            const reason = offer?.reason || navigation.reason || null;
            const purchaseWindowExpired = reason === "purchase_window_expired";
            const alreadyPurchased = reason === "already_purchased";

            this.clearPostRegistration();
            this.clearCheckoutPending();

            if (purchaseWindowExpired || alreadyPurchased) {
                navigateReplace(myProductsLink);
                return { redirected: true, reason };
            }

            window.setTimeout(() => {
                navigateReplace(myProductsLink);
            }, redirectDelayMs);

            return { redirected: true, delayed: true, reason: reason || "no_offer" };
        },

        async restoreExtendedWarrantyOffer(options = {}) {
            const myProductsLink = resolveMyProductsLink(options);
            const access = await ensureOfferAccessAllowed({
                myProductsLink,
                ...options,
            });

            if (!access.allowed) {
                return false;
            }

            const registerId = resolveRegisterId(options);
            if (!registerId || !window.ExtendedWarrantyOffer) {
                return false;
            }

            try {
                const offer =
                    normalizeOfferResponse(access.data) ||
                    (await fetchExtendedWarrantyOffer(registerId));

                if (!offer?.eligible) {
                    if (offer?.reason === "already_purchased") {
                        redirectToMyProducts(myProductsLink, "already_purchased");
                        return false;
                    }
                    return false;
                }

                return await this.renderEligibleOffer(offer, {
                    myProductsLink,
                    customerEmail: options.customerEmail || "",
                    customerName: options.customerName || "",
                });
            } catch (err) {
                console.error("Failed to restore extended warranty offer:", err);
                return false;
            }
        },

        async initRegistrationPage(options = {}) {
            const myProductsLink = resolveMyProductsLink(options);

            const access = await ensureOfferAccessAllowed({ myProductsLink });
            if (!access.allowed) {
                return { redirected: true, reason: access.reason };
            }

            const restored = await this.restoreExtendedWarrantyOffer({
                myProductsLink,
                ...options,
            });

            if (!window.__ewOfferPageGuardBound) {
                window.__ewOfferPageGuardBound = true;
                window.addEventListener("pageshow", async (event) => {
                    if (!event.persisted) return;
                    await ensureOfferAccessAllowed({ myProductsLink });
                });
            }

            return { restored };
        },
    };
})();
