declare namespace NodeJS {
  interface ProcessEnv {
    PORT: string;
    DATABASE_URL: string;
    FRONTEND_ORIGIN: string;
    IMAGEKIT_URL_ENDPOINT: string;
    IMAGEKIT_PUBLIC_KEY: string;
    IMAGEKIT_PRIVATE_KEY: string;
    CORS_ORIGIN_HOPPSCOTCH: string;
    CORS_ORIGIN_FRONTEND: string;
    CORS_ORIGIN_BROWSER_EXTENSION: string;
    RESEND_API_KEY: string;
    JWT_SECRET: string;
  }
}
