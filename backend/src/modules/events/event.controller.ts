import { Request, Response } from 'express';
import { UnauthorizedError } from '../../shared/errors/app-error.js';
import { eventService } from './event.service.js';
import {
  createEventSchema,
  updateEventSchema,
  closeEventSchema,
  type CreateEventInput,
  type UpdateEventInput,
} from './event.validator.js';

export const eventController = {
  async create(req: Request, res: Response): Promise<void> {
    const input = createEventSchema.parse(req.body) as CreateEventInput;

    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedError('Sesi tidak tersedia');
    }

    const { event, membership } = await eventService.createEvent(userId, input);
    res.status(201).json({ success: true, data: { event, membership } });
  },

  async getDetail(req: Request, res: Response): Promise<void> {
    const eventId = req.params.eventId as string;
    const membership = req.membership;
    if (!membership) {
      throw new UnauthorizedError('Keanggotaan event tidak tersedia');
    }

    const { event, membership: membershipOut } = await eventService.getEventDetail(
      eventId,
      membership
    );
    res.status(200).json({ success: true, data: { event, membership: membershipOut } });
  },

  async update(req: Request, res: Response): Promise<void> {
    const eventId = req.params.eventId as string;
    const input = updateEventSchema.parse(req.body) as UpdateEventInput;

    const membership = req.membership;
    if (!membership) {
      throw new UnauthorizedError('Keanggotaan event tidak tersedia');
    }

    const event = await eventService.updateEvent(eventId, membership.id, input);
    res.status(200).json({ success: true, data: { event } });
  },

  async close(req: Request, res: Response): Promise<void> {
    const eventId = req.params.eventId as string;
    closeEventSchema.parse(req.body);

    const membership = req.membership;
    if (!membership) {
      throw new UnauthorizedError('Keanggotaan event tidak tersedia');
    }

    const { cancelledCount } = await eventService.closeEvent(eventId, membership.id);
    res.status(200).json({ success: true, data: { cancelledCount } });
  },
};
