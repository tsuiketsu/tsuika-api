import minioClient from "@/lib/minio";

export default async function deleteImageFromBucket(
  bucket: string,
  fileId: string,
) {
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
