import {
  Page,
  Layout,
  Text,
  Card,
  Stack,
  Link,
} from "@shopify/polaris";

const DASHBOARD_SECTIONS = [
  {
    path: "/standardWarranty",
    title: "Standard Warranty",
    shortLabel: "SW",
    iconClass: "wa-dashboard-card__icon--standard",
    description:
      "Configure warranty durations and assign them to Shopify products.",
  },
  {
    path: "/extendedWarranty",
    title: "Extended Warranty",
    shortLabel: "EW",
    iconClass: "wa-dashboard-card__icon--extended",
    description:
      "Manage plans, pricing, purchase windows, reminders, and refund settings.",
  },
  {
    path: "/retailers",
    title: "Retailers",
    shortLabel: "RT",
    iconClass: "wa-dashboard-card__icon--retailers",
    description:
      "Import and maintain authorized retailers for external purchase flows.",
  },
  {
    path: "/registeredProducts",
    title: "Registered Products",
    shortLabel: "RP",
    iconClass: "wa-dashboard-card__icon--products",
    description:
      "View customer registrations, warranty status, and purchase history.",
  },
  {
    path: "/emailSettings",
    title: "Email Settings",
    shortLabel: "EM",
    iconClass: "wa-dashboard-card__icon--email",
    description:
      "Manage customer email notifications, templates, and preview messages.",
  },
  {
    path: "/serialNumbers",
    title: "Serial Numbers Settings",
    shortLabel: "SN",
    iconClass: "wa-dashboard-card__icon--serials",
    description:
      "Optionally require an imported serial number to complete registration.",
  },
];

export default function HomePage() {
  return (
    <div className="wa-dashboard-page">
      <Page
        title="Dashboard"
        subtitle="Manage warranties, retailers, and registrations"
        fullWidth
      >
      <Layout>
        <Layout.Section>
          <div className="wa-dashboard-hero">
            <Stack vertical spacing="tight">
              <Text as="h2" variant="headingMd">
                Welcome back
              </Text>
              <Text as="p" tone="subdued">
                Choose a section below or use the navigation bar to configure
                warranty settings and manage customer registrations.
              </Text>
            </Stack>
          </div>
        </Layout.Section>

        <Layout.Section>
          <div className="wa-dashboard-grid">
            {DASHBOARD_SECTIONS.map((section) => (
              <div key={section.path} className="wa-dashboard-card-wrap">
                <Card sectioned>
                  <div className="wa-dashboard-card">
                    <div className="wa-dashboard-card__head">
                      <span
                        className={`wa-dashboard-card__icon ${section.iconClass}`}
                        aria-hidden="true"
                      >
                        {section.shortLabel}
                      </span>
                      <Stack vertical spacing="extraTight">
                        <Text as="h3" variant="headingSm">
                          {section.title}
                        </Text>
                        <Text as="p" tone="subdued">
                          {section.description}
                        </Text>
                      </Stack>
                    </div>
                    <div className="wa-dashboard-card__link">
                      <Link url={section.path} removeUnderline>
                        Open {section.title} →
                      </Link>
                    </div>
                  </div>
                </Card>
              </div>
            ))}
          </div>
        </Layout.Section>
      </Layout>
    </Page>
    </div>
  );
}
