import * as dns from "node:dns";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getLinkPreview } from "link-preview-js";

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

export interface LinkPreviewResponsse {
  status: ContentfulStatusCode;
  message: string;
  data: Partial<LinkPreview> | null;
}

export const fetchLinkPreview = async (
  websiteUrl: string,
): Promise<LinkPreviewResponsse> => {
  try {
    const response = await getLinkPreview(websiteUrl, {
      followRedirects: "manual",
      headers: { "user-agent": "Twitterbot" },
      handleRedirects: () => true,
      resolveDNSHost: async (url: string) => {
        return new Promise((resolve, reject) => {
          const hostname = new URL(url).hostname;
          dns.lookup(hostname, (err, address) => {
            if (err) {
              reject(err);
            }
            resolve(address);
          });
        });
      },
    });

    return {
      status: 200,
      message: "Successfully fetched link preview",
      data: response,
    };
    // biome-ignore lint/suspicious/noExplicitAny: false
  } catch (error: any) {
    console.error(error);

    return {
      status: 502,
      message: error.message || "Failed to fetch link preview",
      data: null,
    };
  }
};
