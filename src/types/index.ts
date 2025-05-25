import type { ContentfulStatusCode } from "hono/utils/http-status";

export type SuccessResponse<T = void> = {
  success: true;
  message: string;
  // biome-ignore lint/complexity/noBannedTypes:
} & (T extends void ? {} : { data: T });

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export type PaginatedSuccessResponse<T> = SuccessResponse<T> & {
  pagination: Pagination;
};

export interface CustomResponse {
  status: ContentfulStatusCode;
  message: string;
}

export interface ImageKitReponse extends CustomResponse {
  url: string | null;
  fileId: string | null;
}

export const orderDirections = ["asc", "desc"] as const;
export type OrderDirection = (typeof orderDirections)[number];
