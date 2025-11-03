import { z } from "@hono/zod-openapi";
import minioClient from "@/lib/minio";
import { generatePublicId } from "./nanoid";

// -----------------------------------------
// CREATE OBJECT
// -----------------------------------------
export const objectInsertSchema = z.discriminatedUnion("origin", [
  z.object({ origin: z.literal("local"), fileUri: z.instanceof(File) }),
  z.object({ origin: z.literal("remote"), fileUri: z.url() }),
]);

type CreateObjectArgs = {
  bucket: string;
  objectId?: string;
} & z.infer<typeof objectInsertSchema>;

export const createObjectStoreURL = (bucket: string, objectId: string) => {
  return (
    process.env.S3_BUCKET_URL +
    `/api/v1/buckets/${bucket}/objects/download?` +
    `preview=true&prefix=${objectId}`
  );
};

export type CreateObjectResponse = {
  fileId: string | null;
  url: string | null;
  size: number | null;
  name: string | null;
  mimeType: string | null;
};

const defaultValue = {
  fileId: null,
  url: null,
  size: null,
  name: null,
  mimeType: null,
};

export async function createBucketObject(
  args: CreateObjectArgs,
): Promise<CreateObjectResponse> {
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
        return defaultValue;
      }

      // Create buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const contentType = response.headers.get("content-type");

      const metaData = {
        "Content-Type": contentType,
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

      return {
        fileId: objectId,
        url: createObjectStoreURL(args.bucket, objectId),
        mimeType: contentType,
        name: args.fileUri,
        size: buffer.length,
      };
    } catch (error) {
      console.error(
        `Failed to upload file: "${args.fileUri}" to bucket ${args.bucket}`,
        error,
      );

      return defaultValue;
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

      return {
        fileId: objectId,
        url: createObjectStoreURL(args.bucket, objectId),
        size: buffer.length,
        name: args.fileUri.name,
        mimeType: args.fileUri.type,
      };
    } catch (error) {
      console.error(
        `Failed to upload file: "${args.fileUri.name}" to bucket ${args.bucket}`,
        error,
      );

      return defaultValue;
    }
  }

  return defaultValue;
}

// -----------------------------------------
// DELETE IMAGE HANDLER
// -----------------------------------------

export async function deleteObjectFromBucket(bucket: string, fileId: string) {
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

// -----------------------------------------
// DELETE IMAGES HANDLER
// -----------------------------------------
export async function deleteObjectsFromBucket(
  bucket: string,
  fileIds: string[],
) {
  const exists = await minioClient.bucketExists(bucket);

  if (!exists) return;

  try {
    void (await minioClient.removeObjects(bucket, fileIds));
  } catch (error) {
    console.error(`Failed to delete file ${fileIds}`, error);
  }
}
