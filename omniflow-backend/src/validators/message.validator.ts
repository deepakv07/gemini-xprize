import { z } from 'zod';

export const messageSchema = z.object({
  userId: z.string().uuid({ message: 'userId must be a valid UUID' }),
  message: z.string().min(1, { message: 'message cannot be empty' }),
  channel: z.enum(['whatsapp', 'api']).optional().default('api'),
});

export type MessageInput = z.infer<typeof messageSchema>;
