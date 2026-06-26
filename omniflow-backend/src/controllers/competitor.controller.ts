import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';
import prisma from '../models';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/competitor/update
//
// Body: { businessId: string, product: string, competitorPrice: number, seasonalFactor?: number }
//
// Upserts a CompetitorData row for the given businessId + product.
// ─────────────────────────────────────────────────────────────────────────────

export async function updateCompetitorData(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { businessId, product, competitorPrice, seasonalFactor = 1.0 } = req.body as {
      businessId: string;
      product: string;
      competitorPrice: number;
      seasonalFactor?: number;
    };

    if (!businessId || !product || competitorPrice === undefined) {
      res.status(400).json({
        status: 'error',
        message: 'Request body must include businessId, product, and competitorPrice.',
      });
      return;
    }

    logger.info({ businessId, product, competitorPrice, seasonalFactor }, '[CompetitorController] Upserting competitor data');

    const record = await prisma.competitorData.upsert({
      where:  { businessId_product: { businessId, product } },
      create: { businessId, product, competitorPrice, seasonalFactor },
      update: { competitorPrice, seasonalFactor },
    });

    logger.info({ id: record.id }, '[CompetitorController] Competitor data upserted');

    res.status(200).json({
      status:  'success',
      message: 'Competitor data updated',
      data:    record,
    });
  } catch (err) {
    const error = err as Error;
    logger.error({ err: error.message }, '[CompetitorController] Error');
    next(error);
  }
}
