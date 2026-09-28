import {
  Page,
  LegacyCard,
  TextField,
  Button,
  Text,
  Tabs,
  Checkbox,
  Banner,
  Modal,
  LegacyStack,
} from "@shopify/polaris";
import { useCallback, useEffect, useMemo, useState } from "react";
import LoadingPanel from "../components/LoadingPanel.jsx";
import EmailRichTextEditor from "../components/EmailRichTextEditor.jsx";
import { useToast } from "../hooks/useToast.js";

const API_BASE = "/app/email-settings";
const GLOBAL_URLS_TAB_ID = "global-urls";

/**
 * Lets merchants configure email notification templates, preview the rendered
 * content, manage the shop's global email URLs, and persist shop-level email
 * settings.
 */
export default function EmailSettings() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [urls, setUrls] = useState({
    storeUrl: "",
    privacyUrl: "",
    termsUrl: "",
    supportUrl: "",
  });
  const [urlErrors, setUrlErrors] = useState({});
  const [templates, setTemplates] = useState([]);
  const [selectedTab, setSelectedTab] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");
  const [error, setError] = useState(null);

  /**
   * Loads the saved email configuration from the backend before the form is
   * rendered or when the merchant refreshes the settings screen.
   */
  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API_BASE, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load email settings");
      const data = await res.json();
      setGlobalEnabled(Boolean(data.globalEnabled));
      setUrls({
        storeUrl: data.urls?.storeUrl || "",
        privacyUrl: data.urls?.privacyUrl || "",
        termsUrl: data.urls?.termsUrl || "",
        supportUrl: data.urls?.supportUrl || "",
      });
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch (err) {
      setError(err.message || "Failed to load email settings");
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const tabs = useMemo(
    () => [
      { id: GLOBAL_URLS_TAB_ID, content: "Global URLs" },
      ...templates.map((template) => ({ id: template.key, content: template.label })),
    ],
    [templates]
  );

  const isGlobalUrlsTab = selectedTab === 0;
  const activeTemplate = isGlobalUrlsTab ? null : templates[selectedTab - 1];

  /**
   * Applies an in-memory patch to a template entry so the editor state stays in
   * sync with the current form interaction.
   */
  const updateTemplate = (patch) => {
    setTemplates((prev) =>
      prev.map((item, index) =>
        index === selectedTab - 1 ? { ...item, ...patch } : item
      )
    );
  };

  /**
   * Updates a single global URL field and clears its error once the merchant
   * starts fixing it.
   */
  const updateUrlField = (field, value) => {
    setUrls((current) => ({ ...current, [field]: value }));
    setUrlErrors((current) => ({ ...current, [field]: undefined }));
  };

  /**
   * Validates that all three global URLs are present before saving, since all
   * three are required for the warranty emails.
   */
  const validateUrls = () => {
    const requiredFields = [
      ["storeUrl", "Store URL"],
      ["privacyUrl", "Privacy Policy URL"],
      ["termsUrl", "Terms & Conditions URL"],
      ["supportUrl", "Support URL"],
    ];
    const nextErrors = {};
    requiredFields.forEach(([field, label]) => {
      if (!urls[field]?.trim()) {
        nextErrors[field] = `${label} is required`;
      }
    });
    setUrlErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  /**
   * Persists the merchant's email settings, global URLs, and template
   * overrides back to the server.
   */
  const saveSettings = async () => {
    if (!validateUrls()) {
      setSelectedTab(0);
      toast.showError("Store URL, Privacy Policy URL, Terms & Conditions URL and Support URL are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(API_BASE, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          globalEnabled,
          urls,
          templates: templates.map((template) => ({
            key: template.key,
            enabled: template.enabled,
            subject: template.subject,
            bodyHtml: template.bodyHtml,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save email settings");
      setGlobalEnabled(Boolean(data.globalEnabled));
      setUrls({
        storeUrl: data.urls?.storeUrl || "",
        privacyUrl: data.urls?.privacyUrl || "",
        termsUrl: data.urls?.termsUrl || "",
        supportUrl: data.urls?.supportUrl || "",
      });
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
      toast.showSuccess("Email settings saved");
    } catch (err) {
      setError(err.message || "Failed to save email settings");
      toast.showError(err.message || "Failed to save email settings");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Requests a preview of the active email template so merchants can review the
   * final rendered message before saving.
   */
  const previewTemplate = async () => {
    if (!activeTemplate) return;
    if (!activeTemplate.subject?.trim()) {
      toast.showError("Subject is required to preview");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/preview`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateKey: activeTemplate.key,
          subject: activeTemplate.subject,
          bodyHtml: activeTemplate.bodyHtml,
          urls,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to preview email");
      setPreviewSubject(data.subject);
      setPreviewHtml(data.html);
      setPreviewOpen(true);
    } catch (err) {
      toast.showError(err.message || "Failed to preview email");
    }
  };

  if (loading) {
    return (
      <Page title="Email Settings">
        <LoadingPanel label="Loading email settings..." />
      </Page>
    );
  }

  return (
    <Page
      title="Email Settings"
      subtitle="Manage notification emails sent to customers"
      primaryAction={{
        content: "Save settings",
        onAction: saveSettings,
        loading: saving,
      }}
    >
      {error ? (
        <div className="wa-admin-section-gap">
          <Banner tone="critical">{error}</Banner>
        </div>
      ) : null}

      <LegacyCard sectioned>
        <Checkbox
          label="Enable email notifications"
          helpText="When disabled, no customer emails are sent. Application functionality continues normally."
          checked={globalEnabled}
          onChange={setGlobalEnabled}
        />
      </LegacyCard>

      <div className="wa-admin-section-gap">
        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />
      </div>

      {isGlobalUrlsTab ? (
        <LegacyCard sectioned>
          <LegacyStack vertical gap="400">
            <Text as="h2" variant="headingMd">Global email URLs</Text>
            <Text as="p" tone="subdued">
              Global email URLs are used in all warranty emails. These URLs are required for the emails to function correctly.
            </Text>

            <TextField
              label="Store URL"
              type="url"
              value={urls.storeUrl}
              onChange={(value) => updateUrlField("storeUrl", value)}
              autoComplete="url"
              placeholder="https://example.com"
              requiredIndicator
              error={urlErrors.storeUrl}
            />
            <TextField
              label="Privacy Policy URL"
              type="url"
              value={urls.privacyUrl}
              onChange={(value) => updateUrlField("privacyUrl", value)}
              autoComplete="url"
              placeholder="https://example.com/privacy"
              requiredIndicator
              error={urlErrors.privacyUrl}
            />
            <TextField
              label="Terms & Conditions URL"
              type="url"
              value={urls.termsUrl}
              onChange={(value) => updateUrlField("termsUrl", value)}
              autoComplete="url"
              placeholder="https://example.com/terms"
              requiredIndicator
              error={urlErrors.termsUrl}
            />
            <TextField
              label="Support URL"
              type="url"
              value={urls.supportUrl}
              onChange={(value) => updateUrlField("supportUrl", value)}
              autoComplete="url"
              placeholder="https://example.com/support"
              requiredIndicator
              error={urlErrors.supportUrl}
            />
          </LegacyStack>
        </LegacyCard>
      ) : activeTemplate ? (
        <LegacyCard sectioned>
          <LegacyStack vertical gap="400">
            <Checkbox
              label={`Enable ${activeTemplate.label}`}
              checked={activeTemplate.enabled}
              onChange={(enabled) => updateTemplate({ enabled })}
            />

            <TextField
              label="Email subject"
              value={activeTemplate.subject || ""}
              onChange={(subject) => updateTemplate({ subject })}
              autoComplete="off"
              helpText="Optional. Leave as default or customize the subject line."
            />

            {activeTemplate.description ? (
              <Banner tone="info">{activeTemplate.description}</Banner>
            ) : (
              <Banner tone="info">
                Registration details are added automatically by the app.
                You only need to add optional extra content.
              </Banner>
            )}

            <EmailRichTextEditor
              label="Additional content (optional)"
              value={activeTemplate.bodyHtml || ""}
              onChange={(bodyHtml) => updateTemplate({ bodyHtml })}
            />

            <div className="wa-compact-form-actions">
              <Button onClick={previewTemplate}>Preview email</Button>
            </div>
          </LegacyStack>
        </LegacyCard>
      ) : null}

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Email preview"
        large
        primaryAction={{
          content: "Close",
          onAction: () => setPreviewOpen(false),
        }}
      >
        <Modal.Section>
          <LegacyStack vertical gap="300">
            <Text as="p" variant="bodyMd">
              <strong>Subject:</strong> {previewSubject}
            </Text>
            <div
              className="wa-email-preview-frame"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </LegacyStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
