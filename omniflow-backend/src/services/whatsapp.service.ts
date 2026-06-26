import logger from '../lib/logger';
import axios from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// WhatsAppService
//
// Thin wrapper around the Meta Cloud API v18.0 for sending WhatsApp messages.
// Required env vars:
//   WHATSAPP_TOKEN           — permanent page/system user access token
//   WHATSAPP_PHONE_NUMBER_ID — the phone number ID from Meta dashboard
// ─────────────────────────────────────────────────────────────────────────────

class WhatsAppService {
  private get token(): string {
    return process.env.WHATSAPP_TOKEN ?? '';
  }

  private get phoneNumberId(): string {
    return process.env.WHATSAPP_PHONE_NUMBER_ID ?? '';
  }

  /**
   * Send a plain-text WhatsApp message to a recipient phone number.
   * @param to   - Recipient phone number in E.164 format (e.g. "+919876543210")
   * @param text - The message body text
   */
  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.token || !this.phoneNumberId) {
      logger.warn('[WhatsApp] WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set — message not sent');
      return;
    }

    const url = `https://graph.facebook.com/v18.0/${this.phoneNumberId}/messages`;

    try {
      await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        },
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info({ to }, '[WhatsApp] Message sent successfully');
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? `${err.response?.status ?? 'unknown'} — ${JSON.stringify(err.response?.data)}`
        : (err as Error).message;
      logger.error({ err: msg, to }, '[WhatsApp] Failed to send message');
      throw new Error(`WhatsApp send failed: ${msg}`);
    }
  }
}

export const whatsappService = new WhatsAppService();
export default whatsappService;
