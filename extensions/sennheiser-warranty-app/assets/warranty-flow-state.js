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

  async function fetchExtendedWarrantyOffer(registerId) {
    const res = await fetch(
      `/apps/warranty/extended-warranty/offer?register_id=${encodeURIComponent(registerId)}`
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to load extended warranty offer");
    }
    return data;
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

  function clearOfferFlowState() {
    sessionStorage.removeItem(POST_REG_KEY);
    sessionStorage.removeItem(CHECKOUT_PENDING_KEY);
    clearOfferHistoryState();
  }

  function redirectToMyProducts(myProductsLink, reason) {
    clearOfferFlowState();
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
      const data = await fetchExtendedWarrantyOffer(registerId);

      if (data.reason === "already_purchased" || data.entitlement?.status === "active") {
        return redirectToMyProducts(myProductsLink, "already_purchased");
      }

      if (!data.eligible) {
        if (hasOfferContext) {
          return redirectToMyProducts(
            myProductsLink,
            data.reason || "not_eligible"
          );
        }
        return { allowed: true, action: "continue", myProductsLink, registerId };
      }

      return {
        allowed: true,
        action: "continue",
        data,
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
      if (data?.extendedWarrantyOffer?.eligible) {
        return data.extendedWarrantyOffer;
      }

      const registerId = data?.registrations?.[0]?.registerId;
      if (!registerId) return data?.extendedWarrantyOffer || null;

      try {
        return await fetchExtendedWarrantyOffer(registerId);
      } catch (err) {
        console.warn("Extended warranty offer fetch failed:", err.message);
        return data?.extendedWarrantyOffer || null;
      }
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
            clearOfferFlowState();
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
      const offer = await this.resolveExtendedWarrantyOffer(data);
      const reason = offer?.reason || navigation.reason || null;
      const purchaseWindowExpired = reason === "purchase_window_expired";

      if (offer?.eligible) {
        const rendered = await this.renderEligibleOffer(offer, {
          myProductsLink,
          customerEmail,
          customerName,
        });
        if (rendered) return { shownOffer: true };
      }

      this.clearPostRegistration();
      this.clearCheckoutPending();

      if (purchaseWindowExpired) {
        navigateReplace(myProductsLink);
        return { redirected: true, reason: "purchase_window_expired" };
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
        const data = access.data || (await fetchExtendedWarrantyOffer(registerId));

        if (!data.eligible) {
          if (data.reason === "already_purchased") {
          redirectToMyProducts(myProductsLink, "already_purchased");
          return false;
        }
          return false;
        }

        return await this.renderEligibleOffer(data, {
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
