import {
  Page,
  Layout,
  Image,
  Link,
  Text,
  Card,
  Stack,
  List,
} from "@shopify/polaris";

export default function HomePage() {
  return (
    <Page title="Warranty App">
      <Layout>

        {/* HERO */}
        <Layout.Section>
          <Card sectioned>
            <Stack vertical spacing="loose">
              <Text as="h1" variant="headingLg">
                Welcome to the Warranty App 👋
              </Text>

              <Text as="p" color="subdued">
                Manage product warranties, retailers, and registered customer
                products directly from your Shopify admin .
              </Text>
            </Stack>
          </Card>
        </Layout.Section>

        {/* WHAT YOU CAN DO */}
        <Layout.Section>
          <Card title="What you can do" sectioned>
            <List type="bullet">
              <List.Item>
                Configure standard warranty durations
              </List.Item>
              <List.Item>
                Manage authorized retailers
              </List.Item>
              <List.Item>
                View and track registered products
              </List.Item>
            </List>
          </Card>
        </Layout.Section>

        {/* GETTING STARTED */}
        <Layout.Section>
          <Card sectioned>
            <Stack vertical spacing="tight">
              <Text as="h3" variant="headingSm">
                Getting started
              </Text>

              <Text as="p" color="subdued">
                Use the navigation on the left to configure warranty settings
                and start managing registrations.
              </Text>
            </Stack>
          </Card>
        </Layout.Section>

      </Layout>
    </Page>
  );
}

