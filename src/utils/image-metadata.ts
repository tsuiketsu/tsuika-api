import sharp, { type Metadata } from "sharp";

export const getImageMedatata = async (
  img: string,
): Promise<Metadata | null> => {
  try {
    const response = await fetch(img);
    if (!response.ok) {
      console.error("Failed to fetch image from remote");
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return await sharp(buffer).metadata();
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  } catch (error: any) {
    console.error("Failed to parse image metadata", error.message);
    return null;
  }
};
