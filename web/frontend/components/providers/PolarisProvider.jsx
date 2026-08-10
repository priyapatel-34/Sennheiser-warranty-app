import { Link as RouterLink } from "react-router-dom";
import { AppProvider } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import "../../app.css";
import { getPolarisTranslations } from "../../utils/i18nUtils";

const IS_EXTERNAL_LINK_REGEX = /^(?:[a-z][a-z\d+.-]*:|\/\/)/;

/**
 * Routes Polaris links through React Router for internal navigation while
 * preserving normal anchors for external destinations.
 */
function AppBridgeLink({ url, children, external, ...rest }) {
  if (external || IS_EXTERNAL_LINK_REGEX.test(url)) {
    return (
      <a {...rest} href={url} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  return (
    <RouterLink {...rest} to={url}>
      {children}
    </RouterLink>
  );
}

/**
 * Provides Polaris theme context and translations for the embedded admin app.
 */
export function PolarisProvider({ children }) {
  const translations = getPolarisTranslations();

  return (
    <AppProvider i18n={translations} linkComponent={AppBridgeLink}>
      {children}
    </AppProvider>
  );
}
