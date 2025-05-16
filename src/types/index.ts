import type { ContentfulStatusCode } from "hono/utils/http-status";

export type SuccessResponse<T = void> = {
  success: true;
  message: string;
  // biome-ignore lint/complexity/noBannedTypes:
} & (T extends void ? {} : { data: T });

export type PaginatedSuccessResponse<T> = SuccessResponse<T> & {
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
};

export type ImageKitReponse = {
  status: ContentfulStatusCode;
  message: string;
  url: string | null;
  fileId: string | null;
};
