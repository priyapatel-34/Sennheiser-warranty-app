(() => {
    const TOAST_DURATION_MS = 5000;
    const MAX_VISIBLE = 4;
    const PENDING_TOAST_KEY = "warranty_pending_toast";
    const PENDING_TOAST_MAX_AGE_MS = 2 * 60 * 1000;

    function ensureContainer() {
        let container = document.getElementById("warranty-toast-container");
        if (container) return container;

        container = document.createElement("div");
        container.id = "warranty-toast-container";
        container.className = "warranty-toast-container";
        container.setAttribute("aria-live", "polite");
        container.setAttribute("aria-atomic", "true");
        document.body.appendChild(container);
        return container;
    }

    const ICONS = {
        success: "✓",
        error: "✕",
        warning: "!",
        info: "i",
    };

    function dismissToast(toast) {
        toast.classList.remove("show");
        window.setTimeout(() => toast.remove(), 280);
    }

    function showToast(message, type = "success") {
        if (!message) return;

        const container = ensureContainer();
        while (container.children.length >= MAX_VISIBLE) {
            container.firstChild?.remove();
        }

        const toast = document.createElement("div");
        toast.className = `warranty-toast warranty-toast-${type}`;
        toast.setAttribute("role", "status");

        const icon = document.createElement("span");
        icon.className = "warranty-toast-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = ICONS[type] || ICONS.info;

        const messageEl = document.createElement("span");
        messageEl.className = "warranty-toast-message";
        messageEl.textContent = message;

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "warranty-toast-close";
        closeBtn.setAttribute("aria-label", "Dismiss");
        closeBtn.textContent = "×";
        closeBtn.addEventListener("click", () => dismissToast(toast));

        toast.append(icon, messageEl, closeBtn);
        container.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add("show"));

        window.setTimeout(() => {
            if (toast.isConnected) dismissToast(toast);
        }, TOAST_DURATION_MS);
    }

    function queueToast(message, type = "success") {
        if (!message) return;
        try {
            sessionStorage.setItem(
                PENDING_TOAST_KEY,
                JSON.stringify({ message, type, savedAt: Date.now() })
            );
        } catch {
            // ignore storage errors
        }
    }

    function flushPendingToast() {
        let raw = null;
        try {
            raw = sessionStorage.getItem(PENDING_TOAST_KEY);
            if (!raw) return;
            sessionStorage.removeItem(PENDING_TOAST_KEY);
        } catch {
            return;
        }

        try {
            const pending = JSON.parse(raw);
            if (
                !pending?.message ||
                !pending?.savedAt ||
                Date.now() - pending.savedAt > PENDING_TOAST_MAX_AGE_MS
            ) {
                return;
            }
            showToast(pending.message, pending.type || "success");
        } catch {
            // ignore invalid payload
        }
    }

    function initToastOnLoad() {
        flushPendingToast();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initToastOnLoad);
    } else {
        initToastOnLoad();
    }

    window.WarrantyToast = {
        showSuccess: (message) => showToast(message, "success"),
        showError: (message) => showToast(message, "error"),
        showWarning: (message) => showToast(message, "warning"),
        showInfo: (message) => showToast(message, "info"),
        queueSuccess: (message) => queueToast(message, "success"),
        queueError: (message) => queueToast(message, "error"),
        queueWarning: (message) => queueToast(message, "warning"),
        queueInfo: (message) => queueToast(message, "info"),
        flushPending: flushPendingToast,
    };
})();
