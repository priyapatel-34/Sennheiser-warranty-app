import { BrowserRouter, useLocation } from "react-router-dom";
import { Frame, Navigation } from "@shopify/polaris";
import Routes from "./Routes";
import { QueryProvider, PolarisProvider } from "./components";

import { useNavigate } from "react-router-dom";

function AppContent({ pages }) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <Frame
      navigation={
        <Navigation location={location.pathname}>
          <Navigation.Section
            items={[
              {
                label: "Standard Warranty Setup",
                onClick: () => navigate("/StandardWarranty"),
              },
              {
                label: "Retailers Setup",
                onClick: () => navigate("/Retailers"),
              },
              {
                label: "Registered Products",
                onClick: () => navigate("/RegisteredProducts"),
              },
            ]}
          />
        </Navigation>
      }
    >
      <Routes pages={pages} />
    </Frame>
  );
}

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