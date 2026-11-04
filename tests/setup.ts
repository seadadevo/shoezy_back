process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  ?? "postgresql://postgres:postgres@localhost:5432/shoe_store_auth_rbac_test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-that-is-at-least-thirty-two-characters";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-that-is-different-and-long-enough";
process.env.BCRYPT_ROUNDS = "10";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";
process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = "true";
process.env.CORS_ORIGINS = "http://localhost:3000,https://shoozy-frontend.vercel.app,https://www.shoozy.com";
process.env.FRONTEND_URL = "http://localhost:5173";
