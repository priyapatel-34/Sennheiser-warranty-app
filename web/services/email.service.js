import sgMail from "@sendgrid/mail";
import dotenv from "dotenv";
dotenv.config();

const EMAIL_MODE = (process.env.EMAIL_MODE || "auto").toLowerCase();
const SENDGRID_KEY = process.env.SENDGRID_API_KEY || "";
const DEFAULT_FROM =
  process.env.DEFAULT_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL || "";

function isTestMode() {
  if (EMAIL_MODE === "test" || EMAIL_MODE === "log") return true;
  if (EMAIL_MODE === "production") return false;
  return !SENDGRID_KEY || SENDGRID_KEY.startsWith("SG.test") || SENDGRID_KEY === "dummy";
}

if (SENDGRID_KEY && !isTestMode()) {
  sgMail.setApiKey(SENDGRID_KEY);
}

function normalizeEmailAddress(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function extractSendGridError(error) {
  const body = error.response?.body;
  if (!body) {
    return {
      message: error.message,
      statusCode: error.code || error.response?.statusCode || null,
    };
  }

  const errors = Array.isArray(body.errors) ? body.errors : [];
  return {
    message: errors.map(e => e.message).filter(Boolean).join("; ") || error.message,
    statusCode: error.code || error.response?.statusCode || null,
    errors,
  };
}

/**
 * SendGrid supports sending to the same address as the verified sender
 * (from === to). Delivery still requires the FROM address to be verified
 * as a Single Sender or authenticated domain in SendGrid.
 */
export const sendEmailService = async ({
  to,
  subject,
  html,
  text,
  from,
  replyTo,
}) => {
  const resolvedFrom = from || DEFAULT_FROM || "noreply@example.com";
  const payload = {
    to,
    from: resolvedFrom,
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
      sameAddress:
        normalizeEmailAddress(payload.to) === normalizeEmailAddress(payload.from),
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

  if (!DEFAULT_FROM && !from) {
    console.warn(
      "⚠️ DEFAULT_FROM_EMAIL is not set — SendGrid requires a verified sender address"
    );
  }

  try {
    const response = await sgMail.send(payload);
    const messageId = response[0]?.headers?.["x-message-id"] || null;
    const statusCode = response[0]?.statusCode || 202;

    console.log("📧 Email accepted by SendGrid:", {
      to: payload.to,
      from: payload.from,
      subject: payload.subject,
      statusCode,
      messageId,
      sameAddress:
        normalizeEmailAddress(payload.to) === normalizeEmailAddress(payload.from),
    });

    return {
      success: true,
      messageId,
      statusCode,
    };
  } catch (error) {
    const parsed = extractSendGridError(error);
    console.error("SendGrid Error:", {
      to: payload.to,
      from: payload.from,
      subject: payload.subject,
      statusCode: parsed.statusCode,
      message: parsed.message,
      hint:
        parsed.statusCode === 403
          ? "Verify the sender address in SendGrid (Settings → Sender Authentication)."
          : parsed.message?.toLowerCase().includes("suppression")
            ? "Recipient may be on SendGrid suppression list."
            : undefined,
      details: parsed.errors || undefined,
    });

    return {
      success: false,
      error: parsed.message || error.message,
      statusCode: parsed.statusCode || null,
    };
  }
};
