import sgMail from "@sendgrid/mail";
import dotenv from "dotenv";
dotenv.config();

const EMAIL_MODE = (process.env.EMAIL_MODE || "auto").toLowerCase();
const SENDGRID_KEY = process.env.SENDGRID_API_KEY || "";

function isTestMode() {
  if (EMAIL_MODE === "test" || EMAIL_MODE === "log") return true;
  if (EMAIL_MODE === "production") return false;
  return !SENDGRID_KEY || SENDGRID_KEY.startsWith("SG.test") || SENDGRID_KEY === "dummy";
}

if (SENDGRID_KEY && !isTestMode()) {
  sgMail.setApiKey(SENDGRID_KEY);
}

export const sendEmailService = async ({
  to,
  subject,
  html,
  text,
  from,
  replyTo,
}) => {
  const payload = {
    to,
    from: from || process.env.DEFAULT_FROM_EMAIL || "noreply@example.com",
    subject,
    html,
    text: text || (html ? html.replace(/<[^>]*>?/gm, "") : ""),
    replyTo,
  };

  if (isTestMode()) {
    console.log("📧 [EMAIL TEST MODE] Would send email:", {
      to: payload.to,
      from: payload.from,
      subject: payload.subject,
      mode: EMAIL_MODE || "auto",
      preview: payload.text?.slice(0, 200),
    });
    return {
      success: true,
      skipped: true,
      testMode: true,
      messageId: `test-${Date.now()}`,
    };
  }

  if (!SENDGRID_KEY) {
    console.warn("⚠️ SENDGRID_API_KEY not configured — skipping email:", subject);
    return { success: false, error: "SendGrid not configured", skipped: true };
  }

  try {
    const response = await sgMail.send(payload);
    console.log("📧 Email sent:", { to, subject, messageId: response[0].headers["x-message-id"] });
    return {
      success: true,
      messageId: response[0].headers["x-message-id"],
    };
  } catch (error) {
    console.error("SendGrid Error:", error.response?.body || error.message);
    return {
      success: false,
      error: error.message,
    };
  }
};
