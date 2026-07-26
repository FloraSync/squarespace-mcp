FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --global npm@11.16.0 && npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --global npm@11.16.0 \
  && npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
ENTRYPOINT ["node", "dist/main.js"]
CMD ["--http"]
