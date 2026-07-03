import sgMail from "@sendgrid/mail";
import dotenv from "dotenv";
dotenv.config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

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
