import ImageKit from "imagekit";
import type { ImageKitReponse } from "../types";

const imageKit = new ImageKit({
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
});

const validateImageKitCredentials = () => {
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
      fileId: null,
    };
  }
};

export const uploadOnImageKit = async (
  localFile: File,
): Promise<ImageKitReponse> => {
  validateImageKitCredentials();

  try {
    if (localFile.size > 500 * 1024) {
      return {
        status: 413,
        message: "File is larger than set limit. Max 500KB allowed",
        url: null,
        fileId: null,
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
      fileId: response.fileId,
    };
    // biome-ignore lint/suspicious/noExplicitAny: false
  } catch (error: any) {
    return {
      status: 502,
      message: error.message || "File upload failed. Please try again later",
      url: null,
      fileId: null,
    };
  }
};

export const deleteFromImageKit = async (fileId: string) => {
  validateImageKitCredentials();

  try {
    const response = await imageKit.deleteFile(fileId);

    if (response) {
      console.log("Successfully deleted file from ImageKit");
    }
    // biome-ignore lint/suspicious/noExplicitAny: false
  } catch (error: any) {
    console.error(error.message || "Failed to delete file from ImageKit");
  }
};
