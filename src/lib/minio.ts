import * as Minio from "minio";

const minioClient = new Minio.Client({
  useSSL: process.env.S3_BUCKET_USE_SSL === "true",
  endPoint: process.env.S3_BUCKET_ENDPOINT,
  port: process.env.S3_BUCKET_API_PORT,
  accessKey: process.env.S3_BUCKET_ACCESS_KEY,
  secretKey: process.env.S3_BUCKET_KEY,
});

export default minioClient;
