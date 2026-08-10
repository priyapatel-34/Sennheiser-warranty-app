import { BrowserRouter, Link } from "react-router-dom";
import { NavMenu } from "@shopify/app-bridge-react";
import Routes from "./Routes";
import { QueryProvider, PolarisProvider } from "./components";
import AppLayout from "./components/AppLayout.jsx";

/**
 * Wraps the active page tree with the embedded-app navigation chrome and the
 * shared Polaris/React Query providers.
 */
function AppContent({ pages }) {
  return (
    <>
      <NavMenu>
        <Link to="/" rel="home">
          Sonova Warranty App
        </Link>
      </NavMenu>
      <AppLayout>
        <Routes pages={pages} />
      </AppLayout>
    </>
  );
}

/**
 * Bootstraps the frontend app and wires up the file-based route map from Vite.
 */
export default function App() {
  const pages = import.meta.glob(
    "./pages/**/!(*.test.[jt]sx)*.([jt]sx)",
    { eager: true }
  );

  return (
    <PolarisProvider>
      <BrowserRouter>
        <QueryProvider>
          <AppContent pages={pages} />
        </QueryProvider>
      </BrowserRouter>
    </PolarisProvider>
  );
}
