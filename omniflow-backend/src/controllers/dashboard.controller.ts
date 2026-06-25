import { Request, Response, NextFunction } from 'express';
import prisma from '../models';
import logger from '../lib/logger';

/**
 * GET /api/v1/dashboard/stats
 * 
 * Aggregates live database statistics for the Admin Dashboard:
 *   • Total customer count
 *   • Average purchase probability
 *   • Average expected order value
 *   • Average lifetime value (LTV)
 *   • Forecasted revenue (sum of expectedOrderValue * purchaseProbability)
 *   • Segment distribution counts
 *   • Customer directory table data
 */
export async function getDashboardStats(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    logger.info('[DashboardController] Fetching stats…');

    // Fetch users with their profiles, latest prediction, and latest strategy
    const users = await prisma.user.findMany({
      include: {
        customerProfile: true,
        predictions: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
        strategies: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalCustomers = users.length;
    let sumPurchaseProb = 0;
    let countWithPredictions = 0;
    let sumExpectedOrderVal = 0;
    let sumLtv = 0;
    let forecastedRevenue = 0;

    const segments: Record<string, number> = {
      'high-value': 0,
      'frequent-buyer': 0,
      'price-sensitive': 0,
      'at-risk': 0,
      'new': 0,
    };

    const customerDirectory = users.map((user) => {
      const latestPred = user.predictions[0] ?? null;
      const latestStrat = user.strategies[0] ?? null;

      if (latestPred) {
        countWithPredictions++;
        sumPurchaseProb += latestPred.purchaseProbability;
        sumExpectedOrderVal += latestPred.expectedOrderValue;
        sumLtv += latestPred.ltv;
        // Forecasted revenue as the expected value: EOV * Probability
        forecastedRevenue += latestPred.expectedOrderValue * latestPred.purchaseProbability;

        const segment = latestPred.segment ?? 'new';
        if (segment in segments) {
          segments[segment]++;
        } else {
          segments['new']++;
        }
      } else {
        // Fallback for users without ML predictions yet
        segments['new']++;
        if (user.customerProfile) {
          sumLtv += user.customerProfile.lifetimeValue;
        }
      }

      return {
        id: user.id,
        name: user.name,
        phoneNumber: user.phoneNumber,
        segment: latestPred?.segment ?? 'new',
        purchaseProbability: latestPred?.purchaseProbability ?? 0,
        expectedOrderValue: latestPred?.expectedOrderValue ?? 0,
        recommendedAction: latestStrat?.recommendedAction ?? null,
        createdAt: user.createdAt,
      };
    });

    const avgPurchaseProbability = countWithPredictions > 0 ? sumPurchaseProb / countWithPredictions : 0;
    const avgExpectedOrderValue = countWithPredictions > 0 ? sumExpectedOrderVal / countWithPredictions : 0;
    const avgLtv = totalCustomers > 0 ? sumLtv / totalCustomers : 0;

    res.status(200).json({
      status: 'success',
      metrics: {
        totalCustomers,
        avgPurchaseProbability: parseFloat(avgPurchaseProbability.toFixed(4)),
        avgExpectedOrderValue: parseFloat(avgExpectedOrderValue.toFixed(2)),
        avgLtv: parseFloat(avgLtv.toFixed(2)),
        forecastedRevenue: parseFloat(forecastedRevenue.toFixed(2)),
      },
      segments,
      customers: customerDirectory,
    });
  } catch (err) {
    const error = err as Error;
    logger.error({ err: error.message, stack: error.stack }, '[DashboardController] Failed to compile stats');
    next(error);
  }
}
