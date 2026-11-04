FROM node:22-alpine

# Prisma's migration engine needs OpenSSL on Alpine. Keep the existing base.
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
# The compiler and Prisma CLI are devDependencies; retain the CLI for release jobs.
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
# Generation needs a syntactically valid URL, not a running database or secrets.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
RUN mkdir -p /app/storage/uploads && chown node:node /app/storage/uploads
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',{signal:AbortSignal.timeout(4000)}).then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"
# Run Node as PID 1 so Docker's SIGTERM reaches the existing shutdown handler.
CMD ["node", "dist/src/server.js"]
