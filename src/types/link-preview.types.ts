import type { CustomResponse } from ".";

export type LinkPreview = {
  url: string;
  title: string;
  siteName: string | undefined;
  description: string | undefined;
  mediaType: string;
  contentType: string | undefined;
  images: string[];
  videos: {
    url: string | undefined;
    secureUrl: string | null | undefined;
    type: string | null | undefined;
    width: string | undefined;
    height: string | undefined;
  }[];
  favicons: string[];
  charset: string | null;
};

export interface LinkPreviewResponsse extends CustomResponse {
  data: Partial<LinkPreview> | null;
}
