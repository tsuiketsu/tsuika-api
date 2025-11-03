import * as Minio from "minio";

const minioClient = new Minio.Client({
  endPoint: "localhost",
  port: 9000,
  useSSL: false,
  accessKey: "admin",
  secretKey: "minioadmin",
});

export default minioClient;
