import { Request } from 'express';

/** Authenticated request with tenant context injected by middleware. */
export interface AuthenticatedRequest extends Request {
  tenantId: string;
  stakeholderId: string;
  stakeholderRole: string;
}

/** Standard paginated query params. */
export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

/** Standard API envelope. */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    page: number;
    limit: number;
    total: number;
  };
}

/** Domain enum matching the 5 AssetZentri domains. */
export type Domain = 'it_assets' | 'saas' | 'compliance' | 'contracts' | 'identity';

/** Severity levels used across signals, fusion rules, controls. */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Delivery mode for signal routing. */
export type DeliveryMode = 'realtime' | 'brief' | 'digest' | 'silent';

/** Notification channel types. */
export type ChannelType = 'email' | 'slack' | 'teams' | 'webhook' | 'in_app';
