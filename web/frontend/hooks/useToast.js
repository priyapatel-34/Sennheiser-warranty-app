import { useMemo } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

/**
 * Returns a small wrapper around the Shopify App Bridge toast API so the UI
 * can show consistent success and error messages from anywhere in the app.
 */
export function useToast() {
  const shopify = useAppBridge();

  return useMemo(
    () => ({
      showSuccess(message) {
        shopify.toast.show(message, { duration: 4000 });
      },
      showError(message) {
        shopify.toast.show(message, { isError: true, duration: 4000 });
      },
    }),
    [shopify]
  );
}
