import type { LinkPreviewResponsse } from "@/types/link-preview.types";

// link-preview-js doesn't works except node.js envs
export const fetchLinkPreview = async (
  url: string,
): Promise<LinkPreviewResponsse> => {
  try {
    const response = await fetch(
      `${process.env.LINK_METADATA_API_URL}/api/v1`,
      {
        method: "POST",
        headers: {
          "X-Source": "Cloudflare-Workers",
          "Content-Type": "application/json",
          "x-api-key": process.env.LINK_METADATA_API_KEY,
        },
        body: JSON.stringify({ url }),
      },
    );

    if (!response.ok) {
      return {
        status: 502,
        message: "Failed to fetch link preview",
        data: null,
      };
    }

    return response.json();
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

// export const fetchLinkPreview = async (
//   websiteUrl: string,
// ): Promise<LinkPreviewResponsse> => {
//   try {
//     const response = await getLinkPreview(websiteUrl, {
//       resolveDNSHost: async (url: string) => {
//         return new Promise((resolve, reject) => {
//           const hostname = new URL(url).hostname;
//           dns.lookup(hostname, (err, address) => {
//             if (err) {
//               reject(err);
//             }
//             resolve(address);
//           });
//         });
//       },
//     });
//
//     return {
//       status: 200,
//       message: "Successfully fetched link preview",
//       data: response,
//     };
//     // biome-ignore lint/suspicious/noExplicitAny: false
//   } catch (error: any) {
//     console.error(error);
//
//     return {
//       status: 502,
//       message: error.message || "Failed to fetch link preview",
//       data: null,
//     };
//   }
// };
