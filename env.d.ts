declare namespace NodeJS {
  interface ProcessEnv {
    PORT: string;
    DATABASE_URL: string;
    FRONTEND_ORIGIN: string;
  }
}
