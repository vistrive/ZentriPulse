import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { badRequest, serverError } from '../utils/response';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    const messages = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
    badRequest(res, messages.join('; '));
    return;
  }

  serverError(res, err);
}
