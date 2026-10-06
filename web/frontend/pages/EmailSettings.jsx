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
  Select,
  Popover,
  OptionList,
  Tag,
} from "@shopify/polaris";
import { useCallback, useEffect, useMemo, useState } from "react";
import LoadingPanel from "../components/LoadingPanel.jsx";
import { useToast } from "../hooks/useToast.js";

const API_BASE = "/app/email-settings";
const GLOBAL_URLS_TAB_ID = "global-urls";

function withEnglish(languages) {
  const list = Array.isArray(languages) ? languages : [];
  if (list.some((language) => language.code === "en")) return list;
  return [{ code: "en", label: "English", isDefault: list.length === 0 }, ...list];
}

/**
 * Lets merchants configure email notification templates, preview the rendered
 * content, manage the shop's global email URLs, and persist shop-level email
 * settings.
 *
 * Styles for the "es-" classes live in app.css.
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
  const [languages, setLanguages] = useState([]);
  const [languageOptions, setLanguageOptions] = useState([]);
  const [copyDefaults, setCopyDefaults] = useState({});
  const [languageByTemplate, setLanguageByTemplate] = useState({});
  const [selectedTab, setSelectedTab] = useState(0);
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewLanguage, setPreviewLanguage] = useState("");
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
      setLanguages(withEnglish(data.languages));
      setLanguageOptions(Array.isArray(data.languageOptions) ? data.languageOptions : []);
      setCopyDefaults(data.copyDefaults || {});
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch (err) {
      setError(err.message || "Failed to load email settings");
      setLanguages([]);
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
  const defaultLanguage = languages.find((language) => language.isDefault)?.code || languages[0]?.code || "";
  const selectedLanguage = activeTemplate
    ? languages.some((language) => language.code === languageByTemplate[activeTemplate.key])
      ? languageByTemplate[activeTemplate.key]
      : defaultLanguage
    : "";
  const activeVariant = activeTemplate?.variants?.find(
    (variant) => variant.languageCode === selectedLanguage
  );
  const languageMeta = (code) =>
    languageOptions.find((option) => option.code === code) || { code, short: code, label: code };

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
   * Updates only the selected language's subject or extra content.
   */
  const updateActiveVariant = (patch) => {
    if (!activeTemplate || !selectedLanguage) return;
    setTemplates((prev) =>
      prev.map((item) => {
        if (item.key !== activeTemplate.key) return item;
        const variants = Array.isArray(item.variants) ? item.variants : [];
        const exists = variants.some((variant) => variant.languageCode === selectedLanguage);
        const nextVariants = exists
          ? variants.map((variant) =>
              variant.languageCode === selectedLanguage ? { ...variant, ...patch } : variant
            )
          : [...variants, { languageCode: selectedLanguage, subject: "", bodyHtml: "", ...patch }];
        return { ...item, variants: nextVariants };
      })
    );
  };

  const enableLanguage = (option) => {
    if (languages.some((language) => language.code === option.code)) return;
    setLanguages((current) => [
      ...current,
      { code: option.code, label: option.label, isDefault: current.length === 0 },
    ]);
    setTemplates((current) =>
      current.map((template) => {
        if ((template.variants || []).some((variant) => variant.languageCode === option.code)) {
          return template;
        }
        return {
          ...template,
          variants: [
            ...(template.variants || []),
            {
              languageCode: option.code,
              subject: copyDefaults?.[option.code]?.[template.key]?.subject || template.defaultSubject || "",
              bodyHtml: "",
              strings: { ...(copyDefaults?.[option.code]?.[template.key] || {}) },
            },
          ],
        };
      })
    );
  };

  const removeLanguage = (code) => {
    if (code === "en") {
      toast.showError("English stays available as the fallback language");
      return;
    }
    setLanguages((current) => {
      const next = current.filter((language) => language.code !== code);
      if (!next.length) return current;
      if (!next.some((language) => language.isDefault)) {
        return next.map((language) => ({ ...language, isDefault: language.code === "en" }));
      }
      return next;
    });
  };

  /**
   * Turns a single language on or off. The last remaining language cannot be
   * removed, so a store always has something to send.
   */
  const toggleLanguage = (option) => {
    if (languages.some((language) => language.code === option.code)) {
      if (languages.length === 1) {
        toast.showError("Keep at least one language for this store");
        return;
      }
      removeLanguage(option.code);
      return;
    }
    enableLanguage(option);
  };

  /**
   * Handles the multi-select dropdown by working out which languages were
   * added or removed and reusing the same enable/remove logic as before.
   */
  const handleLanguageSelection = (nextCodes) => {
    const currentCodes = languages.map((language) => language.code);
    const added = nextCodes.filter((code) => !currentCodes.includes(code));
    const removed = currentCodes.filter((code) => !nextCodes.includes(code));
    if (!nextCodes.includes("en")) {
      toast.showError("English stays available as the fallback language");
      nextCodes = ["en", ...nextCodes];
    }
    if (!nextCodes.length) {
      toast.showError("Keep at least one language for this store");
      return;
    }
    removed.filter((code) => code !== "en").forEach(removeLanguage);
    added.forEach((code) => {
      const option = languageOptions.find((item) => item.code === code);
      if (option) enableLanguage(option);
    });
  };

  const setDefaultLanguage = (code) => {
    setLanguages((current) =>
      current.map((language) => ({ ...language, isDefault: language.code === code }))
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
    if (!languages.length) {
      toast.showError("Add at least one language for this store");
      return;
    }
    if (!languages.some((language) => language.isDefault)) {
      toast.showError("Choose one default language for this store");
      return;
    }
    if (!validateUrls()) {
      setSelectedTab(0);
      toast.showError("Store URL, Privacy Policy URL, Terms & Conditions URL and Support URL are required");
      return;
    }
    if (activeTemplate) {
      if (!selectedLanguage) {
        toast.showError("Choose a language before saving this email");
        return;
      }
      if (!activeVariant?.subject?.trim()) {
        toast.showError("Subject is required");
        return;
      }
    }
    const savedTemplateKey = activeTemplate?.key || "";
    const savedLanguageCode = selectedLanguage;
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
          languages,
          ...(activeTemplate
            ? {
                template: {
                  key: activeTemplate.key,
                  enabled: activeTemplate.enabled,
                  languageCode: selectedLanguage,
                  subject: activeVariant?.subject || "",
                  bodyHtml: activeVariant?.bodyHtml || "",
                  strings: activeVariant?.strings || {},
                },
              }
            : {}),
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
      setLanguages(withEnglish(data.languages));
      setLanguageOptions(Array.isArray(data.languageOptions) ? data.languageOptions : []);
      setCopyDefaults(data.copyDefaults || {});
      if (savedTemplateKey) {
        const incoming = (data.templates || []).find((item) => item.key === savedTemplateKey);
        setTemplates((current) =>
          current.map((template) => {
            if (template.key !== savedTemplateKey || !incoming) return template;
            const savedVariant = (incoming.variants || []).find(
              (variant) => variant.languageCode === savedLanguageCode
            );
            return {
              ...template,
              enabled: incoming.enabled,
              variants: (template.variants || []).map((variant) =>
                variant.languageCode === savedLanguageCode && savedVariant ? savedVariant : variant
              ),
            };
          })
        );
      }
      toast.showSuccess(savedTemplateKey ? "Email template saved" : "Email settings saved");
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
    if (!selectedLanguage) {
      toast.showError("Add a store language before previewing");
      return;
    }
    if (!activeVariant?.subject?.trim()) {
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
          subject: activeVariant.subject,
          bodyHtml: activeVariant.bodyHtml,
          languageCode: selectedLanguage,
          strings: activeVariant.strings || {},
          urls,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to preview email");
      setPreviewSubject(data.subject);
      setPreviewHtml(data.html);
      setPreviewLanguage(
        languages.find((language) => language.code === selectedLanguage)?.label || selectedLanguage
      );
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

  const urlFields = [
    { key: "storeUrl", label: "Store URL", placeholder: "https://example.com" },
    { key: "privacyUrl", label: "Privacy Policy URL", placeholder: "https://example.com/privacy" },
    { key: "termsUrl", label: "Terms & Conditions URL", placeholder: "https://example.com/terms" },
    { key: "supportUrl", label: "Support URL", placeholder: "https://example.com/support" },
  ];

  /**
   * Renders one editable copy field so short and long fields share identical
   * wiring.
   */
  const renderField = (field) => (
    <TextField
      key={field.key}
      label={field.label}
      value={activeVariant?.strings?.[field.key] || ""}
      helpText={field.help}
      multiline={field.multiline ? 2 : undefined}
      autoComplete="off"
      disabled={!selectedLanguage}
      onChange={(value) =>
        updateActiveVariant({
          strings: { ...(activeVariant?.strings || {}), [field.key]: value },
        })
      }
    />
  );

  const languageSummary = languages.length
    ? languages.map((language) => languageMeta(language.code).short).join(", ")
    : "Choose languages";

  const languagePickerActivator = (
    <button
      type="button"
      className={`es-select${languagePickerOpen ? " is-open" : ""}`}
      aria-expanded={languagePickerOpen}
      aria-haspopup="listbox"
      onClick={() => setLanguagePickerOpen((open) => !open)}
    >
      <span className="es-select__value">{languageSummary}</span>
      <span className="es-select__chevron" aria-hidden="true" />
    </button>
  );

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
      <div className="es-page es-stack es-gap-400">
        {error ? <Banner tone="critical">{error}</Banner> : null}

        {!globalEnabled ? (
          <Banner tone="warning" title="Email notifications are turned off">
            <p>No customer emails will be sent until you turn them back on. Save settings to apply the change.</p>
          </Banner>
        ) : null}

        <LegacyCard>
          <div className="es-general">
            <div className="es-general__col">
              <div className="es-stack es-gap-200">
                <div className="es-row es-row--between">
                  <Text as="h2" variant="headingMd">Email delivery</Text>
                  <span className={`es-badge${globalEnabled ? " es-badge--on" : ""}`}>
                    {globalEnabled ? "On" : "Off"}
                  </span>
                </div>
                <Checkbox
                  label="Enable email notifications"
                  helpText="No customer emails are sent while this is off."
                  checked={globalEnabled}
                  onChange={setGlobalEnabled}
                />
              </div>
            </div>

            <div className="es-general__col">
              <div className="es-stack es-gap-200">
                <Text as="h2" variant="headingMd">Store languages</Text>
                <Popover
                  active={languagePickerOpen}
                  activator={languagePickerActivator}
                  onClose={() => setLanguagePickerOpen(false)}
                  fullWidth
                  preferredAlignment="left"
                  autofocusTarget="first-node"
                >
                  <OptionList
                    allowMultiple
                    options={languageOptions.map((option) => ({
                      value: option.code,
                      label: `${option.label} (${option.short})`,
                    }))}
                    selected={languages.map((language) => language.code)}
                    onChange={handleLanguageSelection}
                  />
                </Popover>
                <p className="es-note">Each language keeps its own subject and wording.</p>
                {languages.length ? (
                  <div className="es-tags">
                    {languages.map((language) => {
                      const option = languageOptions.find((item) => item.code === language.code);
                      const isEnglish = language.code === "en";
                      return (
                        <Tag
                          key={language.code}
                          onRemove={
                            isEnglish
                              ? undefined
                              : () => toggleLanguage(option || { code: language.code, label: language.label })
                          }
                        >
                          {languageMeta(language.code).label}
                        </Tag>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="es-general__col">
              <div className="es-stack es-gap-200">
                <Text as="h2" variant="headingMd">Default language</Text>
                <Select
                  label="Default language"
                  labelHidden
                  options={languages.map((language) => ({
                    label: languageMeta(language.code).label,
                    value: language.code,
                  }))}
                  value={defaultLanguage}
                  onChange={setDefaultLanguage}
                  disabled={languages.length === 0}
                  helpText="Used when the customer’s language is not enabled."
                />
              </div>
            </div>
          </div>
        </LegacyCard>

        <LegacyCard>
          <div className="es-tabs">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />
          </div>
          <hr className="es-divider" />

          {isGlobalUrlsTab ? (
            <div className="es-pad">
              <div className="es-stack es-gap-400">
                <div className="es-stack es-gap-100">
                  <Text as="h2" variant="headingMd">Global email URLs</Text>
                  <Text as="p" tone="subdued">
                    Global email URLs are used in all warranty emails. These URLs are required for the emails to function correctly.
                  </Text>
                </div>
                <div className="es-grid-2">
                  {urlFields.map((field) => (
                    <TextField
                      key={field.key}
                      label={field.label}
                      type="url"
                      value={urls[field.key]}
                      onChange={(value) => updateUrlField(field.key, value)}
                      autoComplete="url"
                      placeholder={field.placeholder}
                      requiredIndicator
                      error={urlErrors[field.key]}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : activeTemplate ? (
            <div className="es-pad">
              <div className="es-stack es-gap-400">
                <div className="es-stack es-gap-100">
                  <div className="es-row">
                    <Text as="h2" variant="headingMd">{activeTemplate.label}</Text>
                    <span className={`es-badge${activeTemplate.enabled ? " es-badge--on" : ""}`}>
                      {activeTemplate.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <p className="es-note">
                    Edit the subject and wording for the selected template language.
                  </p>
                </div>

                <div className="es-editor">
                  <div className="es-stack es-gap-300">
                    <TextField
                      label="Email subject"
                      value={activeVariant?.subject || ""}
                      onChange={(subject) => updateActiveVariant({ subject })}
                      autoComplete="off"
                      disabled={!selectedLanguage}
                    />

                    {["Content", "Labels", "Footer"].map((section) => {
                      const fields = (activeTemplate.fields || []).filter((field) => field.section === section);
                      if (!fields.length) return null;
                      const shortFields = fields.filter((field) => !field.multiline);
                      const longFields = fields.filter((field) => field.multiline);
                      return (
                        <div key={section} className="es-section">
                          <div className="es-section__head">
                            <Text as="h3" variant="headingSm">{section}</Text>
                          </div>
                          <div className="es-section__body">
                            <div className="es-stack es-gap-300">
                              {shortFields.length ? (
                                <div className="es-grid-3">{shortFields.map(renderField)}</div>
                              ) : null}
                              {longFields.length ? (
                                <div className="es-grid-2">{longFields.map(renderField)}</div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    <TextField
                      label="Extra note (optional)"
                      value={activeVariant?.bodyHtml || ""}
                      multiline={2}
                      autoComplete="off"
                      disabled={!selectedLanguage}
                      onChange={(bodyHtml) => updateActiveVariant({ bodyHtml })}
                      helpText="Added after the purchase notice. Leave empty if you do not need more text."
                    />
                  </div>

                  <aside className="es-side" aria-label="Template options">
                    <div className="es-side__block">
                      <Checkbox
                        label={`Enable ${activeTemplate.label}`}
                        checked={activeTemplate.enabled}
                        onChange={(enabled) => updateTemplate({ enabled })}
                      />
                    </div>

                    <div className="es-side__block">
                      <Select
                        label="Template language"
                        options={languages.map((language) => {
                          const meta = languageMeta(language.code);
                          return {
                            label: language.isDefault
                              ? `${meta.label} (${meta.short}) · Default`
                              : `${meta.label} (${meta.short})`,
                            value: language.code,
                          };
                        })}
                        value={selectedLanguage}
                        onChange={(code) =>
                          setLanguageByTemplate((current) => ({
                            ...current,
                            [activeTemplate.key]: code,
                          }))
                        }
                      />
                    </div>

                    <div className="es-side__block">
                      <div className="es-stack es-gap-300">
                        <Button fullWidth onClick={previewTemplate}>Preview email</Button>
                        <p className="es-note">
                          Names, products, dates, and order numbers stay generated. This save updates only this email and language.
                        </p>
                      </div>
                    </div>
                  </aside>
                </div>
              </div>
            </div>
          ) : null}
        </LegacyCard>
      </div>

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={previewLanguage ? `Email preview (${previewLanguage})` : "Email preview"}
        large
        primaryAction={{
          content: "Close",
          onAction: () => setPreviewOpen(false),
        }}
      >
        <Modal.Section>
          <LegacyStack vertical gap="300">
            <div className="es-preview-subject">
              <Text as="p" variant="bodyMd">
                <strong>Subject:</strong> {previewSubject}
              </Text>
            </div>
            <div className="es-preview-shell">
              <div
                className="es-preview-frame wa-email-preview-frame"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </LegacyStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

// import {
//   Page,
//   LegacyCard,
//   TextField,
//   Button,
//   Text,
//   Tabs,
//   Checkbox,
//   Banner,
//   Modal,
//   LegacyStack,
//   Select,
// } from "@shopify/polaris";
// import { useCallback, useEffect, useMemo, useState } from "react";
// import LoadingPanel from "../components/LoadingPanel.jsx";
// import { useToast } from "../hooks/useToast.js";

// const API_BASE = "/app/email-settings";
// const GLOBAL_URLS_TAB_ID = "global-urls";

// /**
//  * Lets merchants configure email notification templates, preview the rendered
//  * content, manage the shop's global email URLs, and persist shop-level email
//  * settings.
//  */
// export default function EmailSettings() {
//   const toast = useToast();
//   const [loading, setLoading] = useState(true);
//   const [saving, setSaving] = useState(false);
//   const [globalEnabled, setGlobalEnabled] = useState(true);
//   const [urls, setUrls] = useState({
//     storeUrl: "",
//     privacyUrl: "",
//     termsUrl: "",
//     supportUrl: "",
//   });
//   const [urlErrors, setUrlErrors] = useState({});
//   const [templates, setTemplates] = useState([]);
//   const [languages, setLanguages] = useState([]);
//   const [languageOptions, setLanguageOptions] = useState([]);
//   const [copyDefaults, setCopyDefaults] = useState({});
//   const [languageByTemplate, setLanguageByTemplate] = useState({});
//   const [selectedTab, setSelectedTab] = useState(0);
//   const [previewOpen, setPreviewOpen] = useState(false);
//   const [previewHtml, setPreviewHtml] = useState("");
//   const [previewSubject, setPreviewSubject] = useState("");
//   const [previewLanguage, setPreviewLanguage] = useState("");
//   const [error, setError] = useState(null);

//   /**
//    * Loads the saved email configuration from the backend before the form is
//    * rendered or when the merchant refreshes the settings screen.
//    */
//   const loadSettings = useCallback(async () => {
//     setLoading(true);
//     setError(null);
//     try {
//       const res = await fetch(API_BASE, { credentials: "include" });
//       if (!res.ok) throw new Error("Failed to load email settings");
//       const data = await res.json();
//       setGlobalEnabled(Boolean(data.globalEnabled));
//       setUrls({
//         storeUrl: data.urls?.storeUrl || "",
//         privacyUrl: data.urls?.privacyUrl || "",
//         termsUrl: data.urls?.termsUrl || "",
//         supportUrl: data.urls?.supportUrl || "",
//       });
//       setLanguages(Array.isArray(data.languages) ? data.languages : []);
//       setLanguageOptions(Array.isArray(data.languageOptions) ? data.languageOptions : []);
//       setCopyDefaults(data.copyDefaults || {});
//       setTemplates(Array.isArray(data.templates) ? data.templates : []);
//     } catch (err) {
//       setError(err.message || "Failed to load email settings");
//       setLanguages([]);
//       setTemplates([]);
//     } finally {
//       setLoading(false);
//     }
//   }, []);

//   useEffect(() => {
//     loadSettings();
//   }, [loadSettings]);

//   const tabs = useMemo(
//     () => [
//       { id: GLOBAL_URLS_TAB_ID, content: "Global URLs" },
//       ...templates.map((template) => ({ id: template.key, content: template.label })),
//     ],
//     [templates]
//   );

//   const isGlobalUrlsTab = selectedTab === 0;
//   const activeTemplate = isGlobalUrlsTab ? null : templates[selectedTab - 1];
//   const defaultLanguage = languages.find((language) => language.isDefault)?.code || languages[0]?.code || "";
//   const selectedLanguage = activeTemplate
//     ? languages.some((language) => language.code === languageByTemplate[activeTemplate.key])
//       ? languageByTemplate[activeTemplate.key]
//       : defaultLanguage
//     : "";
//   const activeVariant = activeTemplate?.variants?.find(
//     (variant) => variant.languageCode === selectedLanguage
//   );
//   const languageMeta = (code) =>
//     languageOptions.find((option) => option.code === code) || { code, short: code, label: code };

//   /**
//    * Applies an in-memory patch to a template entry so the editor state stays in
//    * sync with the current form interaction.
//    */
//   const updateTemplate = (patch) => {
//     setTemplates((prev) =>
//       prev.map((item, index) =>
//         index === selectedTab - 1 ? { ...item, ...patch } : item
//       )
//     );
//   };

//   /**
//    * Updates only the selected language's subject or extra content.
//    */
//   const updateActiveVariant = (patch) => {
//     if (!activeTemplate || !selectedLanguage) return;
//     setTemplates((prev) =>
//       prev.map((item) => {
//         if (item.key !== activeTemplate.key) return item;
//         const variants = Array.isArray(item.variants) ? item.variants : [];
//         const exists = variants.some((variant) => variant.languageCode === selectedLanguage);
//         const nextVariants = exists
//           ? variants.map((variant) =>
//               variant.languageCode === selectedLanguage ? { ...variant, ...patch } : variant
//             )
//           : [...variants, { languageCode: selectedLanguage, subject: "", bodyHtml: "", ...patch }];
//         return { ...item, variants: nextVariants };
//       })
//     );
//   };

//   const enableLanguage = (option) => {
//     if (languages.some((language) => language.code === option.code)) return;
//     setLanguages((current) => [
//       ...current,
//       { code: option.code, label: option.label, isDefault: current.length === 0 },
//     ]);
//     setTemplates((current) =>
//       current.map((template) => ({
//         ...template,
//         variants: [
//           ...(template.variants || []).filter((variant) => variant.languageCode !== option.code),
//           {
//             languageCode: option.code,
//             subject: copyDefaults?.[option.code]?.[template.key]?.subject || template.defaultSubject || "",
//             bodyHtml: "",
//             strings: { ...(copyDefaults?.[option.code]?.[template.key] || {}) },
//           },
//         ],
//       }))
//     );
//   };

//   const toggleLanguage = (option) => {
//     if (languages.some((language) => language.code === option.code)) {
//       removeLanguage(option.code);
//       return;
//     }
//     enableLanguage(option);
//   };

//   const removeLanguage = (code) => {
//     setLanguages((current) => {
//       const next = current.filter((language) => language.code !== code);
//       if (!next.length) return current;
//       if (!next.some((language) => language.isDefault)) {
//         next[0] = { ...next[0], isDefault: true };
//       }
//       return next;
//     });
//     setTemplates((current) =>
//       current.map((template) => ({
//         ...template,
//         variants: (template.variants || []).filter((variant) => variant.languageCode !== code),
//       }))
//     );
//   };

//   const setDefaultLanguage = (code) => {
//     setLanguages((current) =>
//       current.map((language) => ({ ...language, isDefault: language.code === code }))
//     );
//   };

//   /**
//    * Updates a single global URL field and clears its error once the merchant
//    * starts fixing it.
//    */
//   const updateUrlField = (field, value) => {
//     setUrls((current) => ({ ...current, [field]: value }));
//     setUrlErrors((current) => ({ ...current, [field]: undefined }));
//   };

//   /**
//    * Validates that all three global URLs are present before saving, since all
//    * three are required for the warranty emails.
//    */
//   const validateUrls = () => {
//     const requiredFields = [
//       ["storeUrl", "Store URL"],
//       ["privacyUrl", "Privacy Policy URL"],
//       ["termsUrl", "Terms & Conditions URL"],
//       ["supportUrl", "Support URL"],
//     ];
//     const nextErrors = {};
//     requiredFields.forEach(([field, label]) => {
//       if (!urls[field]?.trim()) {
//         nextErrors[field] = `${label} is required`;
//       }
//     });
//     setUrlErrors(nextErrors);
//     return Object.keys(nextErrors).length === 0;
//   };

//   /**
//    * Persists the merchant's email settings, global URLs, and template
//    * overrides back to the server.
//    */
//   const saveSettings = async () => {
//     if (!languages.length) {
//       toast.showError("Add at least one language for this store");
//       return;
//     }
//     if (!languages.some((language) => language.isDefault)) {
//       toast.showError("Choose one default language for this store");
//       return;
//     }
//     if (!validateUrls()) {
//       setSelectedTab(0);
//       toast.showError("Store URL, Privacy Policy URL, Terms & Conditions URL and Support URL are required");
//       return;
//     }
//     setSaving(true);
//     setError(null);
//     try {
//       const res = await fetch(API_BASE, {
//         method: "PUT",
//         credentials: "include",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           globalEnabled,
//           urls,
//           languages,
//           templates: templates.map((template) => ({
//             key: template.key,
//             enabled: template.enabled,
//             variants: (template.variants || []).map((variant) => ({
//               languageCode: variant.languageCode,
//               subject: variant.subject,
//               bodyHtml: variant.bodyHtml,
//               strings: variant.strings || {},
//             })),
//           })),
//         }),
//       });
//       const data = await res.json();
//       if (!res.ok) throw new Error(data.error || "Failed to save email settings");
//       setGlobalEnabled(Boolean(data.globalEnabled));
//       setUrls({
//         storeUrl: data.urls?.storeUrl || "",
//         privacyUrl: data.urls?.privacyUrl || "",
//         termsUrl: data.urls?.termsUrl || "",
//         supportUrl: data.urls?.supportUrl || "",
//       });
//       setLanguages(Array.isArray(data.languages) ? data.languages : []);
//       setLanguageOptions(Array.isArray(data.languageOptions) ? data.languageOptions : []);
//       setCopyDefaults(data.copyDefaults || {});
//       setTemplates(Array.isArray(data.templates) ? data.templates : []);
//       toast.showSuccess("Email settings saved");
//     } catch (err) {
//       setError(err.message || "Failed to save email settings");
//       toast.showError(err.message || "Failed to save email settings");
//     } finally {
//       setSaving(false);
//     }
//   };

//   /**
//    * Requests a preview of the active email template so merchants can review the
//    * final rendered message before saving.
//    */
//   const previewTemplate = async () => {
//     if (!activeTemplate) return;
//     if (!selectedLanguage) {
//       toast.showError("Add a store language before previewing");
//       return;
//     }
//     if (!activeVariant?.subject?.trim()) {
//       toast.showError("Subject is required to preview");
//       return;
//     }
//     try {
//       const res = await fetch(`${API_BASE}/preview`, {
//         method: "POST",
//         credentials: "include",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           templateKey: activeTemplate.key,
//           subject: activeVariant.subject,
//           bodyHtml: activeVariant.bodyHtml,
//           languageCode: selectedLanguage,
//           strings: activeVariant.strings || {},
//           urls,
//         }),
//       });
//       const data = await res.json();
//       if (!res.ok) throw new Error(data.error || "Failed to preview email");
//       setPreviewSubject(data.subject);
//       setPreviewHtml(data.html);
//       setPreviewLanguage(
//         languages.find((language) => language.code === selectedLanguage)?.label || selectedLanguage
//       );
//       setPreviewOpen(true);
//     } catch (err) {
//       toast.showError(err.message || "Failed to preview email");
//     }
//   };

//   if (loading) {
//     return (
//       <Page title="Email Settings">
//         <LoadingPanel label="Loading email settings..." />
//       </Page>
//     );
//   }

//   return (
//     <Page
//       title="Email Settings"
//       subtitle="Manage notification emails sent to customers"
//       primaryAction={{
//         content: "Save settings",
//         onAction: saveSettings,
//         loading: saving,
//       }}
//     >
//       {error ? (
//         <div className="wa-admin-section-gap">
//           <Banner tone="critical">{error}</Banner>
//         </div>
//       ) : null}

//       <LegacyCard sectioned>
//         <Checkbox
//           label="Enable email notifications"
//           helpText="When disabled, no customer emails are sent. Application functionality continues normally."
//           checked={globalEnabled}
//           onChange={setGlobalEnabled}
//         />
//       </LegacyCard>

//       <div className="wa-admin-section-gap">
//         <LegacyCard sectioned>
//           <LegacyStack vertical gap="400">
//             <div className="wa-lang-setup">
//               <div>
//                 <Text as="h2" variant="headingMd">Store languages</Text>
//                 <Text as="p" tone="subdued">
//                   Turn on the languages this store sends. The default is used when the customer’s language is not enabled.
//                 </Text>
//               </div>
//               <div className="wa-lang-picks" role="group" aria-label="Store languages">
//                 {languageOptions.map((option) => {
//                   const selected = languages.some((language) => language.code === option.code);
//                   return (
//                     <button
//                       key={option.code}
//                       type="button"
//                       className={`wa-lang-pick${selected ? " is-selected" : ""}`}
//                       aria-pressed={selected}
//                       onClick={() => toggleLanguage(option)}
//                     >
//                       <span className="wa-lang-pick__code">{option.short}</span>
//                       {option.label}
//                     </button>
//                   );
//                 })}
//               </div>
//               <div className="wa-lang-default">
//                 <Select
//                   label="Default language"
//                   labelHidden
//                   options={languages.map((language) => ({
//                     label: `Default: ${languageMeta(language.code).label}`,
//                     value: language.code,
//                   }))}
//                   value={defaultLanguage}
//                   onChange={setDefaultLanguage}
//                   disabled={languages.length === 0}
//                 />
//               </div>
//             </div>
//           </LegacyStack>
//         </LegacyCard>
//       </div>

//       <div className="wa-admin-section-gap">
//         <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />
//       </div>

//       {isGlobalUrlsTab ? (
//         <LegacyCard sectioned>
//           <LegacyStack vertical gap="400">
//             <Text as="h2" variant="headingMd">Global email URLs</Text>
//             <Text as="p" tone="subdued">
//               Global email URLs are used in all warranty emails. These URLs are required for the emails to function correctly.
//             </Text>

//             <TextField
//               label="Store URL"
//               type="url"
//               value={urls.storeUrl}
//               onChange={(value) => updateUrlField("storeUrl", value)}
//               autoComplete="url"
//               placeholder="https://example.com"
//               requiredIndicator
//               error={urlErrors.storeUrl}
//             />
//             <TextField
//               label="Privacy Policy URL"
//               type="url"
//               value={urls.privacyUrl}
//               onChange={(value) => updateUrlField("privacyUrl", value)}
//               autoComplete="url"
//               placeholder="https://example.com/privacy"
//               requiredIndicator
//               error={urlErrors.privacyUrl}
//             />
//             <TextField
//               label="Terms & Conditions URL"
//               type="url"
//               value={urls.termsUrl}
//               onChange={(value) => updateUrlField("termsUrl", value)}
//               autoComplete="url"
//               placeholder="https://example.com/terms"
//               requiredIndicator
//               error={urlErrors.termsUrl}
//             />
//             <TextField
//               label="Support URL"
//               type="url"
//               value={urls.supportUrl}
//               onChange={(value) => updateUrlField("supportUrl", value)}
//               autoComplete="url"
//               placeholder="https://example.com/support"
//               requiredIndicator
//               error={urlErrors.supportUrl}
//             />
//           </LegacyStack>
//         </LegacyCard>
//       ) : activeTemplate ? (
//         <LegacyCard sectioned>
//           <LegacyStack vertical gap="400">
//             <Checkbox
//               label={`Enable ${activeTemplate.label}`}
//               checked={activeTemplate.enabled}
//               onChange={(enabled) => updateTemplate({ enabled })}
//             />

//             <div className="wa-lang-picks" role="group" aria-label="Template language">
//               {languages.map((language) => {
//                 const meta = languageMeta(language.code);
//                 const selected = language.code === selectedLanguage;
//                 return (
//                   <button
//                     key={language.code}
//                     type="button"
//                     className={`wa-lang-pick${selected ? " is-selected" : ""}`}
//                     aria-pressed={selected}
//                     onClick={() =>
//                       setLanguageByTemplate((current) => ({
//                         ...current,
//                         [activeTemplate.key]: language.code,
//                       }))
//                     }
//                   >
//                     <span className="wa-lang-pick__code">{meta.short}</span>
//                     {meta.label}
//                   </button>
//                 );
//               })}
//             </div>

//             <TextField
//               label="Email subject"
//               value={activeVariant?.subject || ""}
//               onChange={(subject) => updateActiveVariant({ subject })}
//               autoComplete="off"
//               disabled={!selectedLanguage}
//             />

//             <Text as="p" tone="subdued">
//               Customer names, product details, dates, and order numbers stay in place. Edit the labels and sentences around them. This language does not change the others.
//             </Text>

//             {["Content", "Labels", "Footer"].map((section) => {
//               const fields = (activeTemplate.fields || []).filter((field) => field.section === section);
//               if (!fields.length) return null;
//               return (
//                 <div key={section} className="wa-email-fields">
//                   <div className="wa-email-fields__wide">
//                     <Text as="h3" variant="headingSm">{section}</Text>
//                   </div>
//                   {fields.map((field) => (
//                     <div key={field.key} className={field.multiline ? "wa-email-fields__wide" : ""}>
//                       <TextField
//                         label={field.label}
//                         value={activeVariant?.strings?.[field.key] || ""}
//                         helpText={field.help}
//                         multiline={field.multiline ? 2 : undefined}
//                         autoComplete="off"
//                         disabled={!selectedLanguage}
//                         onChange={(value) =>
//                           updateActiveVariant({
//                             strings: { ...(activeVariant?.strings || {}), [field.key]: value },
//                           })
//                         }
//                       />
//                     </div>
//                   ))}
//                 </div>
//               );
//             })}

//             <TextField
//               label="Extra note (optional)"
//               value={activeVariant?.bodyHtml || ""}
//               multiline={2}
//               autoComplete="off"
//               disabled={!selectedLanguage}
//               onChange={(bodyHtml) => updateActiveVariant({ bodyHtml })}
//               helpText="Added after the purchase notice. Leave empty if you do not need more text."
//             />

//             <div className="wa-compact-form-actions">
//               <Button onClick={previewTemplate}>Preview email</Button>
//             </div>
//           </LegacyStack>
//         </LegacyCard>
//       ) : null}

//       <Modal
//         open={previewOpen}
//         onClose={() => setPreviewOpen(false)}
//         title={previewLanguage ? `Email preview (${previewLanguage})` : "Email preview"}
//         large
//         primaryAction={{
//           content: "Close",
//           onAction: () => setPreviewOpen(false),
//         }}
//       >
//         <Modal.Section>
//           <LegacyStack vertical gap="300">
//             <Text as="p" variant="bodyMd">
//               <strong>Subject:</strong> {previewSubject}
//             </Text>
//             <div
//               className="wa-email-preview-frame"
//               dangerouslySetInnerHTML={{ __html: previewHtml }}
//             />
//           </LegacyStack>
//         </Modal.Section>
//       </Modal>
//     </Page>
//   );
// }
