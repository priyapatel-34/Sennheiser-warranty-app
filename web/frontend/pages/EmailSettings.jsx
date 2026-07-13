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
import { useCallback, useEffect, useState } from "react";
import LoadingPanel from "../components/LoadingPanel.jsx";
import EmailRichTextEditor from "../components/EmailRichTextEditor.jsx";
import { useToast } from "../hooks/useToast.js";

const API_BASE = "/app/email-settings";

export default function EmailSettings() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [selectedTab, setSelectedTab] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");
  const [error, setError] = useState(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API_BASE, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load email settings");
      const data = await res.json();
      setGlobalEnabled(Boolean(data.globalEnabled));
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

  const activeTemplate = templates[selectedTab];

  const updateTemplate = (patch) => {
    setTemplates((prev) =>
      prev.map((item, index) =>
        index === selectedTab ? { ...item, ...patch } : item
      )
    );
  };

  const saveSettings = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(API_BASE, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          globalEnabled,
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
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
      toast.showSuccess("Email settings saved");
    } catch (err) {
      setError(err.message || "Failed to save email settings");
      toast.showError(err.message || "Failed to save email settings");
    } finally {
      setSaving(false);
    }
  };

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

      {templates.length > 0 ? (
        <>
          <div className="wa-admin-section-gap">
            <Tabs
              tabs={templates.map((template) => ({
                id: template.key,
                content: template.label,
              }))}
              selected={selectedTab}
              onSelect={setSelectedTab}
            />
          </div>

          {activeTemplate ? (
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

                <Text as="p" tone="subdued" variant="bodySm">
                  This content is appended to the standard email.
                </Text>

                <div className="wa-compact-form-actions">
                  <Button onClick={previewTemplate}>Preview email</Button>
                </div>
              </LegacyStack>
            </LegacyCard>
          ) : null}
        </>
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
// } from "@shopify/polaris";
// import { useCallback, useEffect, useState } from "react";
// import LoadingPanel from "../components/LoadingPanel.jsx";
// import { useToast } from "../hooks/useToast.js";

// const API_BASE = "/app/email-settings";

// export default function EmailSettings() {
//   const toast = useToast();
//   const [loading, setLoading] = useState(true);
//   const [saving, setSaving] = useState(false);
//   const [globalEnabled, setGlobalEnabled] = useState(true);
//   const [templates, setTemplates] = useState([]);
//   const [selectedTab, setSelectedTab] = useState(0);
//   const [previewOpen, setPreviewOpen] = useState(false);
//   const [previewHtml, setPreviewHtml] = useState("");
//   const [previewSubject, setPreviewSubject] = useState("");
//   const [previewLoading, setPreviewLoading] = useState(false);
//   const [error, setError] = useState(null);
//   const [delivery, setDelivery] = useState(null);

//   const loadSettings = useCallback(async () => {
//     setLoading(true);
//     setError(null);
//     try {
//       const res = await fetch(API_BASE, { credentials: "include" });
//       if (!res.ok) throw new Error("Failed to load email settings");
//       const data = await res.json();
//       setGlobalEnabled(Boolean(data.globalEnabled));
//       setDelivery(data.delivery || null);
//       setTemplates(
//         (Array.isArray(data.templates) ? data.templates : []).map((t) => ({
//           ...t,
//           additionalNotes: t.additionalNotes || "",
//         }))
//       );
//     } catch (err) {
//       setError(err.message || "Failed to load email settings");
//       setTemplates([]);
//       setDelivery(null);
//     } finally {
//       setLoading(false);
//     }
//   }, []);

//   useEffect(() => {
//     loadSettings();
//   }, [loadSettings]);

//   const activeTemplate = templates[selectedTab];

//   const updateTemplate = (patch) => {
//     setTemplates((prev) =>
//       prev.map((item, index) =>
//         index === selectedTab ? { ...item, ...patch } : item
//       )
//     );
//   };

//   const saveSettings = async () => {
//     setSaving(true);
//     setError(null);
//     try {
//       const res = await fetch(API_BASE, {
//         method: "PUT",
//         credentials: "include",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           globalEnabled,
//           templates: templates.map((template) => ({
//             key: template.key,
//             enabled: template.enabled,
//             additionalNotes: template.additionalNotes,
//           })),
//         }),
//       });
//       const data = await res.json();
//       if (!res.ok) throw new Error(data.error || "Failed to save email settings");
//       setGlobalEnabled(Boolean(data.globalEnabled));
//       setDelivery(data.delivery || null);
//       setTemplates(
//         (Array.isArray(data.templates) ? data.templates : []).map((t) => ({
//           ...t,
//           additionalNotes: t.additionalNotes || "",
//         }))
//       );
//       toast.showSuccess("Email settings saved");
//     } catch (err) {
//       setError(err.message || "Failed to save email settings");
//       toast.showError(err.message || "Failed to save email settings");
//     } finally {
//       setSaving(false);
//     }
//   };

//   const previewTemplate = async () => {
//     if (!activeTemplate) return;
//     setPreviewLoading(true);
//     try {
//       const res = await fetch(`${API_BASE}/preview`, {
//         method: "POST",
//         credentials: "include",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           templateKey: activeTemplate.key,
//           additionalNotes: activeTemplate.additionalNotes,
//         }),
//       });
//       const data = await res.json();
//       if (!res.ok) throw new Error(data.error || "Failed to preview email");
//       setPreviewSubject(data.subject);
//       setPreviewHtml(data.html);
//       setPreviewOpen(true);
//     } catch (err) {
//       toast.showError(err.message || "Failed to preview email");
//     } finally {
//       setPreviewLoading(false);
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
//       subtitle="Manage customer notification emails"
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

//       {delivery && !delivery.ready ? (
//         <div className="wa-admin-section-gap">
//           <Banner tone="warning" title="Email delivery is not configured">
//             <p>
//               Customer emails cannot be sent until SendGrid is configured on the
//               server. Set <strong>SENDGRID_API_KEY</strong> and{" "}
//               <strong>DEFAULT_FROM_EMAIL</strong> (a verified SendGrid sender)
//               in your hosting environment variables, then restart the app.
//             </p>
//             {!delivery.sendgridConfigured ? (
//               <p>Missing: SENDGRID_API_KEY</p>
//             ) : null}
//             {!delivery.fromEmailConfigured ? (
//               <p>Missing: DEFAULT_FROM_EMAIL</p>
//             ) : null}
//           </Banner>
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

//       {templates.length > 0 ? (
//         <>
//           <div className="wa-admin-section-gap">
//             <Tabs
//               tabs={templates.map((template) => ({
//                 id: template.key,
//                 content: template.label,
//               }))}
//               selected={selectedTab}
//               onSelect={setSelectedTab}
//             />
//           </div>

//           {activeTemplate ? (
//             <LegacyCard sectioned>
//               <div className="wa-stack-12">
//                 <Checkbox
//                   label={`Enable ${activeTemplate.label}`}
//                   checked={activeTemplate.enabled}
//                   onChange={(enabled) => updateTemplate({ enabled })}
//                 />

//                 <Banner tone="info">
//                   Email layout, branding, and content are fixed to the approved
//                   Sennheiser design. Use Additional Notes below to append
//                   optional shop-specific text — it appears in a dedicated
//                   section when filled in.
//                 </Banner>

//                 <TextField
//                   label="Additional Notes"
//                   value={activeTemplate.additionalNotes || ""}
//                   onChange={(additionalNotes) => updateTemplate({ additionalNotes })}
//                   multiline={6}
//                   autoComplete="off"
//                   helpText="Optional plain-text notes appended to this email. Leave blank to omit the section entirely."
//                 />

//                 <div className="wa-compact-form-actions">
//                   <Button onClick={previewTemplate} loading={previewLoading}>
//                     Preview email
//                   </Button>
//                 </div>
//               </div>
//             </LegacyCard>
//           ) : null}
//         </>
//       ) : null}

//       <Modal
//         open={previewOpen}
//         onClose={() => setPreviewOpen(false)}
//         title="Email preview"
//         large
//         primaryAction={{
//           content: "Close",
//           onAction: () => setPreviewOpen(false),
//         }}
//       >
//         <Modal.Section>
//           <div className="wa-stack-12">
//             <Text as="p" variant="bodyMd">
//               <strong>Subject:</strong> {previewSubject}
//             </Text>
//             <Text as="p" tone="subdued" variant="bodySm">
//               Read-only preview with sample data. This is how the email will
//               look to customers.
//             </Text>
//             <div
//               className="wa-email-preview-frame"
//               dangerouslySetInnerHTML={{ __html: previewHtml }}
//             />
//           </div>
//         </Modal.Section>
//       </Modal>
//     </Page>
//   );
// }
