import minioClient from "@/lib/minio";
import { generatePublicId } from "./nanoid";

type ImageUploadArgs = {
  bucket: string;
  objectId?: string;
} & (
  | { origin: "local"; fileUri: File }
  | { origin: "remote"; fileUri: string }
);

export type ImageBucketStoreResponse = {
  fileId: string;
};

export default async function storeImageToBucket(args: ImageUploadArgs) {
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
        return;
      }

      // Create buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const metaData = {
        "Content-Type": response.headers.get("content-type") || "image/jpeg",
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
    } catch (error) {
      console.error(
        `Failed to upload file: "${args.fileUri}" to bucket ${args.bucket}`,
        error,
      );
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
    } catch (error) {
      console.error(
        `Failed to upload file: "${args.fileUri.name}" to bucket ${args.bucket}`,
        error,
      );
    }
  }
}
