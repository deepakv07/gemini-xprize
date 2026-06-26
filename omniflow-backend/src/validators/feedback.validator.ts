import { z } from 'zod';

export const feedbackSchema = z.object({
  userId: z.string().uuid({ message: 'userId must be a valid UUID' }),
  strategyId: z.string().uuid({ message: 'strategyId must be a valid UUID' }),
  outcome: z.enum(['PURCHASE', 'REJECT', 'IGNORE']),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;
