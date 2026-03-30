import { Response } from 'express';
import { ApiResponse } from '../types';

export function ok<T>(res: Response, data: T, meta?: ApiResponse<T>['meta']): void {
  const body: ApiResponse<T> = { success: true, data };
  if (meta) body.meta = meta;
  res.status(200).json(body);
}

export function created<T>(res: Response, data: T): void {
  res.status(201).json({ success: true, data } as ApiResponse<T>);
}

export function noContent(res: Response): void {
  res.status(204).send();
}

export function badRequest(res: Response, message: string): void {
  res.status(400).json({ success: false, error: message } as ApiResponse<never>);
}

export function unauthorized(res: Response, message = 'Unauthorized'): void {
  res.status(401).json({ success: false, error: message } as ApiResponse<never>);
}

export function forbidden(res: Response, message = 'Forbidden'): void {
  res.status(403).json({ success: false, error: message } as ApiResponse<never>);
}

export function notFound(res: Response, resource = 'Resource'): void {
  res.status(404).json({ success: false, error: `${resource} not found` } as ApiResponse<never>);
}

export function serverError(res: Response, err: unknown): void {
  console.error('Internal server error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' } as ApiResponse<never>);
}
