import ImageKit = require("imagekit");
import type { ImageKitReponse } from "../types/schema.types";

const imageKit = new ImageKit({
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
});

const uploadOnImageKit = async (localFile: File): Promise<ImageKitReponse> => {
  if (
    !process.env.IMAGEKIT_URL_ENDPOINT ||
    !process.env.IMAGEKIT_PRIVATE_KEY ||
    !process.env.IMAGEKIT_PUBLIC_KEY
  ) {
    return {
      status: 500,
      message:
        "ImageKig credentials missing, URL_ENDPOINT, PRIVATE_KEY, PUBLIC_KEY are required",
      url: null,
    };
  }

  try {
    if (localFile.size > 500 * 1024) {
      return {
        status: 413,
        message: "File is larger than set limit. Max 500KB allowed",
        url: null,
      };
    }

    const bytes = await localFile.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

    const response = await imageKit.upload({
      file: buffer,
      fileName: `${localFile.name}-${uniqueSuffix}`,
      folder: "tsuika",
      isPublished: true,
    });

    return {
      status: 200,
      message: "file successfully uploaded to imagekit",
      url: response.url,
    };
  } catch (error) {
    return {
      status: 502,
      message: error.message || "File upload failed. Please try again later",
      url: null,
    };
  }
};

export { uploadOnImageKit };
