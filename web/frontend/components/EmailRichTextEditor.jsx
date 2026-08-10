import { useRef, useCallback } from "react";
import { Button, ButtonGroup, Text } from "@shopify/polaris";

const TOOLBAR_ACTIONS = [
  { label: "B", command: "bold", title: "Bold" },
  { label: "I", command: "italic", title: "Italic" },
  { label: "U", command: "underline", title: "Underline" },
  { label: "H2", command: "formatBlock", value: "h2", title: "Heading" },
  { label: "• List", command: "insertUnorderedList", title: "Bullet list" },
  { label: "1. List", command: "insertOrderedList", title: "Numbered list" },
  { label: "Link", command: "createLink", title: "Insert link" },
];

/**
 * Provides a minimal rich-text editor for merchant-authored email body content
 * so template customizations can be edited without leaving the admin app.
 */
export default function EmailRichTextEditor({ value, onChange, label }) {
  const editorRef = useRef(null);

  /**
   * Pushes the current editable HTML back into React state whenever the editor
   * content changes.
   */
  const syncValue = useCallback(() => {
    if (!editorRef.current) return;
    onChange(editorRef.current.innerHTML);
  }, [onChange]);

  /**
   * Runs the selected formatting command against the contenteditable surface and
   * then syncs the updated HTML back into the parent form state.
   */
  const runCommand = (command, valueArg) => {
    editorRef.current?.focus();
    if (command === "createLink") {
      const url = window.prompt("Enter link URL");
      if (!url) return;
      document.execCommand(command, false, url);
    } else if (command === "formatBlock" && valueArg) {
      document.execCommand(command, false, valueArg);
    } else {
      document.execCommand(command, false, valueArg || null);
    }
    syncValue();
  };

  return (
    <div className="wa-email-editor">
      {label ? (
        <Text as="p" variant="bodyMd" fontWeight="medium">
          {label}
        </Text>
      ) : null}
      <div className="wa-email-editor__toolbar">
        <ButtonGroup segmented>
          {TOOLBAR_ACTIONS.map((action) => (
            <Button
              key={action.label}
              size="slim"
              onClick={() => runCommand(action.command, action.value)}
            >
              {action.label}
            </Button>
          ))}
        </ButtonGroup>
      </div>
      <div
        ref={editorRef}
        className="wa-email-editor__surface"
        contentEditable
        suppressContentEditableWarning
        onInput={syncValue}
        dangerouslySetInnerHTML={{ __html: value || "" }}
      />
    </div>
  );
}
