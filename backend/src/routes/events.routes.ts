import { Router } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middleware/auth';
import { ingestEvent, getEventsByDevice } from '../services/event-ingestion.service';
import { detectSequenceGaps } from '../services/sequence-id.service';

const router = Router();

// Zod schema for event ingestion request
const IngestEventSchema = z.object({
  eventType: z.number().int().min(1).max(7),
  eventSubType: z.number().int().optional(),
  eventRecordStatus: z.number().int().min(1).max(4),
  eventRecordOrigin: z.number().int().min(1).max(4),
  eventDate: z.string().regex(/^\d{6}$/),
  eventTime: z.string().regex(/^\d{6}$/),
  timezoneOffset: z.string().regex(/^[+-]\d{4}$/),
  eldDeviceId: z.string().min(1).max(50),
  driverEldAccountId: z.string().max(50).optional(),
  carrierDotNumber: z.string().max(10).optional(),
  metadata: z.record(z.unknown()),
  sequenceId: z.number().int().min(1).max(65535).optional(),
});

/**
 * POST /api/v1/events
 * Ingest a new ELD event.
 */
router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const validatedData = IngestEventSchema.parse(req.body);

    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const result = await ingestEvent({
      ...validatedData,
      actor: {
        userId: req.user.id,
        userRole: req.user.role,
        deviceId: validatedData.eldDeviceId,
        source: 'api',
      },
      network: {
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      },
    });

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/events/:eldDeviceId/:logDate
 * Retrieve events for a specific device and log date.
 */
router.get('/:eldDeviceId/:logDate', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { eldDeviceId, logDate } = req.params;
    const eventType = req.query.eventType
      ? parseInt(req.query.eventType as string, 10)
      : undefined;
    const includeInactive = req.query.includeInactive === 'true';

    const events = await getEventsByDevice(eldDeviceId, logDate, {
      eventType,
      includeInactive,
    });

    res.json({
      success: true,
      data: events,
      count: events.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/events/:eldDeviceId/:logDate/gaps
 * Detect sequence ID gaps for a specific device and log date.
 */
router.get('/:eldDeviceId/:logDate/gaps', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { eldDeviceId, logDate } = req.params;
    const gaps = await detectSequenceGaps(eldDeviceId, logDate);

    res.json({
      success: true,
      data: {
        eldDeviceId,
        logDate,
        gaps,
        gapCount: gaps.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
