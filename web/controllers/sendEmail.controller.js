import { sendEmailService } from "../services/email.service.js";

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
