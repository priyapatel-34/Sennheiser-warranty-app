import { sendEmailService } from "../services/email.service.js";

/**
 * Proxies a raw email send request through the shared email service for admin
 * testing and manual delivery flows.
 */
export const sendEmail = async (req, res) => {
  try {
    const result = await sendEmailService(req.body);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
