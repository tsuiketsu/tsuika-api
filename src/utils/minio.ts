import minioClient from "@/lib/minio";
import { generatePublicId } from "./nanoid";

// -----------------------------------------
// UPLOAD IMAGE HANDLER
// -----------------------------------------
type ImageUploadArgs = {
  bucket: string;
  objectId?: string;
} & (
  | { origin: "local"; fileUri: File }
  | { origin: "remote"; fileUri: string }
);

const generateUrl = (bucket: string, objectId: string) => {
  return (
    process.env.S3_BUCKET_URL +
    `/api/v1/buckets/${bucket}/objects/download?` +
    `preview=true&prefix=${objectId}`
  );
};

export type ImageBucketStoreResponse = {
  fileId: string | null;
  url: string | null;
};

export async function storeImageToBucket(args: ImageUploadArgs): Promise<{
  fileId: string | null;
  url: string | null;
}> {
  // Create bucket if not exists
  const exists = await minioClient.bucketExists(args.bucket);

  if (!exists) {
    await minioClient.makeBucket(args.bucket);
  }

  const objectId = args.objectId ?? generatePublicId();

  if (args.origin === "remote") {
    try {
      const response = await fetch(args.fileUri);

      if (!response.ok || !response.body) {
        return { fileId: null, url: null };
      }

      // Create buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const contentType = response.headers.get("content-type");

      const metaData = {
        "Content-Type": contentType || "image/jpeg",
        "X-Amz-Meta-Project": "tsuika",
        "Cache-Control": "public, max-age=31536000",
      };

      void (await minioClient.putObject(
        args.bucket,
        objectId,
        buffer,
        buffer.length,
        metaData,
      ));

      return { fileId: objectId, url: generateUrl(args.bucket, objectId) };
    } catch (error) {
      console.error(
        `Failed to upload file: "${args.fileUri}" to bucket ${args.bucket}`,
        error,
      );

      return { fileId: null, url: null };
    }
  } else if (args.origin === "local") {
    try {
      const bytes = await args.fileUri.arrayBuffer();
      const buffer = Buffer.from(bytes);

      const metaData = {
        "Content-Type": args.fileUri.type,
        "X-Amz-Meta-Project": "tsuika",
        "Cache-Control": "public, max-age=31536000",
      };

      void (await minioClient.putObject(
        args.bucket,
        objectId,
        buffer,
        buffer.length,
        metaData,
      ));

      return { fileId: objectId, url: generateUrl(args.bucket, objectId) };
    } catch (error) {
      console.error(
        `Failed to upload file: "${args.fileUri.name}" to bucket ${args.bucket}`,
        error,
      );

      return { fileId: null, url: null };
    }
  }

  return { fileId: null, url: null };
}

// -----------------------------------------
// DELETE IMAGE HANDLER
// -----------------------------------------

export async function deleteImageFromBucket(bucket: string, fileId: string) {
  const exists = await minioClient.bucketExists(bucket);

  if (!exists) return;

  try {
    await minioClient.removeObject(bucket, fileId, {
      forceDelete: true,
    });
  } catch (error) {
    console.error(`Failed to delete file ${fileId}`, error);
  }
}
