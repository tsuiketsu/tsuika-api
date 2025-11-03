declare namespace NodeJS {
  interface ProcessEnv {
    PORT: string;
    DATABASE_URL: string;
    DOMAIN: string;
    FRONTEND_ORIGIN: string;
    IMAGEKIT_URL_ENDPOINT: string;
    IMAGEKIT_PUBLIC_KEY: string;
    IMAGEKIT_PRIVATE_KEY: string;
    CORS_ORIGIN_HOPPSCOTCH: string;
    CORS_ORIGIN_FRONTEND: string;
    CORS_ORIGIN_BROWSER_EXTENSION: string;
    RESEND_API_KEY: string;
    JWT_SECRET: string;
    LINK_METADATA_API_URL: string;
    LINK_METADATA_API_KEY: string;
    S3_BUCKET_USE_SSL: string;
    S3_BUCKET_API_PORT: number;
    S3_BUCKET_ENDPOINT: string;
    S3_BUCKET_ACCESS_KEY: string;
    S3_BUCKET_KEY: string;
    S3_BUCKET_URL: string;
  }
}
