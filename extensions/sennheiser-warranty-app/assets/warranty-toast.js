(() => {
  const TOAST_DURATION_MS = 4000;
  const MAX_VISIBLE = 4;

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
    toast.innerHTML = `
      <span class="warranty-toast-icon" aria-hidden="true">${ICONS[type] || ICONS.info}</span>
      <span class="warranty-toast-message">${message}</span>
      <button type="button" class="warranty-toast-close" aria-label="Dismiss">×</button>
    `;
    container.appendChild(toast);

    toast.querySelector(".warranty-toast-close")?.addEventListener("click", () => {
      dismissToast(toast);
    });

    requestAnimationFrame(() => toast.classList.add("show"));

    window.setTimeout(() => {
      if (toast.isConnected) dismissToast(toast);
    }, TOAST_DURATION_MS);
  }

  window.WarrantyToast = {
    showSuccess: message => showToast(message, "success"),
    showError: message => showToast(message, "error"),
    showWarning: message => showToast(message, "warning"),
    showInfo: message => showToast(message, "info"),
  };
})();
