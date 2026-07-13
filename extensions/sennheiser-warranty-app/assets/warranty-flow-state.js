(() => {
    const POST_REG_KEY = "warranty_post_registration_state";
    const REG_CONTEXT_KEY = "warranty_registration_context";
    const CHECKOUT_PENDING_KEY = "ew_checkout_pending";
    const MAX_AGE_MS = 2 * 60 * 60 * 1000;
    const EW_LOADER_MESSAGE = "Loading extended warranty options...";

    function hasPendingOfferTransition(options = {}) {
        if (options.registerId) return true;
        if (resolveRegisterId(options)) return true;
        return (
            Boolean(readJson(POST_REG_KEY)?.registerId) ||
            Boolean(readJson(CHECKOUT_PENDING_KEY)?.registerId) ||
            Boolean(history.state?.ewOffer && history.state?.ewRegisterId)
        );
    }

    function isExtendedWarrantyOfferEnabledInResponse(data) {
        if (data?.extendedWarrantyOfferEnabled === false) return false;
        if (data?.extendedWarrantyOfferEnabled === true) return true;
        return (
            data?.postRegistrationNavigation?.next === "extended_warranty" ||
            data?.showExtendedWarrantyOffer === true
        );
    }

    function shouldAttemptExtendedWarrantyPage(data, offer = null) {
        if (!isExtendedWarrantyOfferEnabledInResponse(data)) return false;
        if (offer?.reason === "feature_disabled") return false;
        return true;
    }

    function showEwTransitionLoader(message = EW_LOADER_MESSAGE) {
        if (window.ExtendedWarrantyOffer?.showPageLoader) {
            window.ExtendedWarrantyOffer.showPageLoader(message);
            return;
        }

        document.documentElement.classList.add("ew-transition-pending");
        const overlay = document.getElementById("ew-page-loader-overlay");
        if (overlay) {
            const textEl = overlay.querySelector(".ew-loader-text");
            if (textEl) textEl.textContent = message;
            overlay.hidden = false;
        }

        document.querySelectorAll(".ew-registration-form-panel").forEach(el => {
            el.classList.add("hidden");
        });
    }

    function clearEwTransitionLoader(restoreForm = false) {
        document.documentElement.classList.remove("ew-transition-pending");

        if (restoreForm) {
            window.ExtendedWarrantyOffer?.hidePageLoader?.();
            window.ExtendedWarrantyOffer?.showRegistrationForm?.();
            return;
        }

        window.ExtendedWarrantyOffer?.hidePageLoader?.();
    }

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
                    if (
                        offer?.reason === "feature_disabled" ||
                        offer?.reason === "purchase_window_expired"
                    ) {
                        return redirectToMyProducts(
                            myProductsLink,
                            offer.reason || "not_eligible"
                        );
                    }
                    if (isRegistrationFormPage()) {
                        resetOfferFlowState();
                        clearEwTransitionLoader(true);
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
        isExtendedWarrantyOfferEnabledInResponse(data) {
            return isExtendedWarrantyOfferEnabledInResponse(data);
        },

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
            const inline = normalizeOfferResponse(data?.extendedWarrantyOffer);

            if (!isExtendedWarrantyOfferEnabledInResponse(data)) {
                return (
                    inline || {
                        eligible: false,
                        reason: inline?.reason || "feature_disabled",
                    }
                );
            }

            if (inline?.eligible && inline?.plans?.length) {
                return inline;
            }

            if (registerId) {
                try {
                    const fetched = await fetchExtendedWarrantyOffer(registerId);
                    if (fetched) return fetched;
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
         * - admin EW setting ON → show offer page (fetch fresh offer data)
         * - admin EW setting OFF → My Products
         */
        async handlePostRegistrationNavigation(data, options = {}) {
            const {
                myProductsLink = "/pages/my-products",
                customerEmail = "",
                customerName = "",
                redirectDelayMs = 4500,
            } = options;

            const navigation = data?.postRegistrationNavigation || {};
            const inlineOffer = normalizeOfferResponse(data?.extendedWarrantyOffer);
            const shouldAttemptEw = shouldAttemptExtendedWarrantyPage(data, inlineOffer);

            if (!shouldAttemptEw) {
                clearEwTransitionLoader();
                this.clearPostRegistration();
                this.clearCheckoutPending();
                navigateReplace(myProductsLink);
                return {
                    redirected: true,
                    reason: inlineOffer?.reason || navigation.reason || "no_offer",
                };
            }

            showEwTransitionLoader();

            const registerId = data?.registrations?.[0]?.registerId;
            let offer = await this.resolveExtendedWarrantyOffer(data);

            if (
                registerId &&
                (!offer?.registration || !offer?.plans?.length)
            ) {
                try {
                    offer = await fetchExtendedWarrantyOffer(registerId);
                } catch (err) {
                    console.warn("Extended warranty offer refetch failed:", err.message);
                }
            }

            if (offer?.eligible) {
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
            const featureDisabled = reason === "feature_disabled";

            this.clearPostRegistration();
            this.clearCheckoutPending();

            if (purchaseWindowExpired || alreadyPurchased || featureDisabled) {
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
                    if (
                        offer?.reason === "already_purchased" ||
                        offer?.reason === "feature_disabled"
                    ) {
                        redirectToMyProducts(
                            myProductsLink,
                            offer.reason || "not_eligible"
                        );
                        return null;
                    }
                    clearEwTransitionLoader(true);
                    return false;
                }

                return await this.renderEligibleOffer(offer, {
                    myProductsLink,
                    customerEmail: options.customerEmail || "",
                    customerName: options.customerName || "",
                });
            } catch (err) {
                console.error("Failed to restore extended warranty offer:", err);
                clearEwTransitionLoader(true);
                return false;
            }
        },

        async initRegistrationPage(options = {}) {
            const myProductsLink = resolveMyProductsLink(options);

            if (hasPendingOfferTransition(options)) {
                showEwTransitionLoader();
            }

            const access = await ensureOfferAccessAllowed({ myProductsLink });
            if (!access.allowed) {
                return { redirected: true, reason: access.reason };
            }

            const restored = await this.restoreExtendedWarrantyOffer({
                myProductsLink,
                ...options,
            });

            if (hasPendingOfferTransition(options) && restored === false) {
                clearEwTransitionLoader(true);
            }

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
