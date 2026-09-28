import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Select, Text } from "@shopify/polaris";

// Moves between admin pages in the current iframe and keeps the Shopify shop/host params.
export function navigateInApp(navigate, location, path) {
  navigate({ pathname: path, search: location.search });
}

export const APP_NAV_ITEMS = [
  { path: "/", label: "Dashboard", shortLabel: "Dashboard" },
  { path: "/standardWarranty", label: "Standard Warranty", shortLabel: "Standard" },
  { path: "/extendedWarranty", label: "Extended Warranty", shortLabel: "Extended" },
  { path: "/retailers", label: "Retailers", shortLabel: "Retailers" },
  { path: "/registeredProducts", label: "Registered Products", shortLabel: "Products" },
  { path: "/emailSettings", label: "Email Settings", shortLabel: "Email" },
];

/**
 * Tracks whether the admin shell should render its compact mobile navigation
 * instead of the full desktop nav.
 */
function useIsNarrowView(breakpoint = 768) {
  const query = `(max-width: ${breakpoint}px)`;
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (event) => setNarrow(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return narrow;
}

/**
 * Determines whether a nav item should be highlighted for the current route.
 */
function isNavItemActive(pathname, path) {
  const normalized = pathname.replace(/\/$/, "") || "/";
  if (path === "/") return normalized === "/";
  return normalized === path || normalized.startsWith(`${path}/`);
}

/**
 * Renders the shared admin shell, including responsive navigation and the main
 * content container used by all internal app pages.
 */
export default function AppLayout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isNarrow = useIsNarrowView();

  const activeItem =
    APP_NAV_ITEMS.find((item) => isNavItemActive(location.pathname, item.path)) ||
    APP_NAV_ITEMS[0];

  return (
    <div className="wa-admin-shell">
      <header className="wa-admin-header" role="navigation" aria-label="Warranty app">
        {isNarrow ? (
          <div className="wa-admin-header__mobile">
            <Select
              label="Navigate to"
              labelHidden
              options={APP_NAV_ITEMS.map((item) => ({
                label: item.label,
                value: item.path,
              }))}
              value={activeItem.path}
              onChange={(value) => navigateInApp(navigate, location, value)}
            />
          </div>
        ) : (
          <>
            <div className="wa-admin-header__brand">
              <Text as="p" variant="headingMd">
                Sonova Warranty App
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Admin dashboard
              </Text>
            </div>
            <nav className="wa-admin-nav" aria-label="Main">
              {APP_NAV_ITEMS.map((item) => {
                const active = isNavItemActive(location.pathname, item.path);
                return (
                  <button
                    key={item.path}
                    type="button"
                    className="wa-admin-nav__link"
                    onClick={() => navigateInApp(navigate, location, item.path)}
                  >
                    <span
                      className={`wa-admin-nav__item${active ? " wa-admin-nav__item--active" : ""}`}
                      aria-current={active ? "page" : undefined}
                    >
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </nav>
          </>
        )}
      </header>

      <main className="wa-admin-content">{children}</main>
    </div>
  );
}
