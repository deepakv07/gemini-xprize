import logger from '../lib/logger';
import axios from 'axios';
import FormData from 'form-data';
import OpenAI from 'openai';

// ─────────────────────────────────────────────────────────────────────────────
// VoiceService
//
// Transcribes WhatsApp voice messages using OpenAI Whisper.
//
// VOICE FLOW:
//   WhatsApp voice message
//     → webhook receives audio mediaId
//     → GET Meta API for download URL
//     → download OGG audio (with auth header)
//     → POST to OpenAI Whisper as multipart/form-data
//     → return transcript text
//     → push text through normal 8-agent pipeline
// ─────────────────────────────────────────────────────────────────────────────

class VoiceService {
  private readonly openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  private get token(): string {
    return process.env.WHATSAPP_TOKEN ?? '';
  }

  /**
   * Download and transcribe a WhatsApp audio message.
   * @param mediaId - The media ID from the WhatsApp webhook payload
   * @returns       - Transcribed text string
   */
  async transcribeAudio(mediaId: string): Promise<string> {
    logger.info({ mediaId }, '[Voice] Transcribing audio');

    // Step 1: Get the media download URL from Meta API
    const metaInfoUrl = `https://graph.facebook.com/v18.0/${mediaId}`;
    const infoRes = await axios.get<{ url: string }>(metaInfoUrl, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    const downloadUrl = infoRes.data.url;
    if (!downloadUrl) {
      throw new Error(`[Voice] Could not get download URL for media ${mediaId}`);
    }

    logger.info({ mediaId }, '[Voice] Got media download URL');

    // Step 2: Download the OGG audio bytes
    const audioRes = await axios.get<Buffer>(downloadUrl, {
      headers: { Authorization: `Bearer ${this.token}` },
      responseType: 'arraybuffer',
    });

    const audioBuffer = Buffer.from(audioRes.data);
    logger.info({ mediaId, bytes: audioBuffer.length }, '[Voice] Audio downloaded');

    // Step 3: Build multipart/form-data and send to Whisper
    const formData = new FormData();
    formData.append('model', 'whisper-1');
    formData.append('file', audioBuffer, {
      filename: 'audio.ogg',
      contentType: 'audio/ogg',
    });

    const whisperRes = await axios.post<{ text: string }>(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          ...formData.getHeaders(),
        },
      }
    );

    const transcript = whisperRes.data.text?.trim() ?? '';
    logger.info({ mediaId, transcript }, '[Voice] Transcription complete');

    return transcript;
  }
}

export const voiceService = new VoiceService();
export default voiceService;
