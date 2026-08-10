import sgMail from "@sendgrid/mail";
import dotenv from "dotenv";
dotenv.config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Sends a transactional email through SendGrid using the app's configured
 * sender address and returns a lightweight success/failure result object.
 */
export const sendEmailService = async ({
  to,
  subject,
  html,
  text,
  from,
  replyTo
}) => {
  try {
    const msg = {
      to,
      from: from || process.env.DEFAULT_FROM_EMAIL,
      subject,
      html,
      text: text || html.replace(/<[^>]*>?/gm, ""),
      replyTo
    };

    const response = await sgMail.send(msg);

    return {
      success: true,
      messageId: response[0].headers["x-message-id"]
    };

  } catch (error) {
    console.error("SendGrid Error:", error.response?.body || error.message);

    return {
      success: false,
      error: error.message
    };
  }
};


// import sgMail from "@sendgrid/mail";
// import dotenv from "dotenv";
// dotenv.config();

// function resolveFromEmail(override) {
//   return (
//     override ||
//     process.env.DEFAULT_FROM_EMAIL ||
//     process.env.SENDGRID_FROM_EMAIL ||
//     null
//   );
// }

// export function getEmailDeliveryStatus() {
//   const apiKey = process.env.SENDGRID_API_KEY?.trim();
//   const fromEmail = resolveFromEmail();
//   return {
//     sendgridConfigured: Boolean(apiKey),
//     fromEmailConfigured: Boolean(fromEmail),
//     fromEmail: fromEmail || null,
//     ready: Boolean(apiKey && fromEmail),
//   };
// }

// function ensureSendGridReady(from) {
//   const status = getEmailDeliveryStatus();
//   const resolvedFrom = resolveFromEmail(from);

//   if (!status.sendgridConfigured) {
//     return {
//       ok: false,
//       error:
//         "SendGrid is not configured. Set SENDGRID_API_KEY in the server environment.",
//     };
//   }

//   if (!resolvedFrom) {
//     return {
//       ok: false,
//       error:
//         "Sender email is not configured. Set DEFAULT_FROM_EMAIL (must be a verified SendGrid sender).",
//     };
//   }

//   sgMail.setApiKey(process.env.SENDGRID_API_KEY.trim());
//   return { ok: true, from: resolvedFrom };
// }

// export const sendEmailService = async ({
//   to,
//   subject,
//   html,
//   text,
//   from,
//   replyTo,
// }) => {
//   const readiness = ensureSendGridReady(from);
//   if (!readiness.ok) {
//     console.error("Email send blocked:", readiness.error, { to, subject });
//     return { success: false, error: readiness.error };
//   }

//   if (!to) {
//     return { success: false, error: "Missing recipient email address" };
//   }

//   if (!subject?.trim()) {
//     return { success: false, error: "Missing email subject" };
//   }

//   if (!html?.trim()) {
//     return { success: false, error: "Missing email HTML body" };
//   }

//   try {
//     const msg = {
//       to,
//       from: readiness.from,
//       subject: subject.trim(),
//       html,
//       text: text || html.replace(/<[^>]*>?/gm, ""),
//       replyTo,
//     };

//     const response = await sgMail.send(msg);

//     console.log("✅ Email sent", {
//       to,
//       subject: subject.trim(),
//       messageId: response[0]?.headers?.["x-message-id"],
//     });

//     return {
//       success: true,
//       messageId: response[0]?.headers?.["x-message-id"],
//     };
//   } catch (error) {
//     const sendGridBody = error.response?.body;
//     console.error("SendGrid Error:", sendGridBody || error.message, { to, subject });

//     const detail =
//       sendGridBody?.errors?.map((e) => e.message).join("; ") || error.message;

//     return {
//       success: false,
//       error: detail,
//       statusCode: error.code || error.response?.statusCode || null,
//     };
//   }
// };
