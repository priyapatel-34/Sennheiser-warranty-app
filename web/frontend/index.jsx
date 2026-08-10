import App from "./App";
import { createRoot } from "react-dom/client";
import { initI18n } from "./utils/i18nUtils";

// Ensure that locales are loaded before rendering the app
/**
 * Loads translation resources before the React tree mounts so the app renders
 * with the correct locale from the very first paint.
 */
initI18n().then(() => {
  const root = createRoot(document.getElementById("app"));
  root.render(<App />);
});
