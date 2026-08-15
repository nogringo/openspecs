FROM node:24-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @openspecs/web build
RUN pnpm --filter @openspecs/web deploy --prod --legacy /prod/web

# No pnpm in the runtime: corepack would fetch and verify it on every container
# start, which needs the network and stalls boot.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /prod/web ./
# deploy honours npm packing rules, which drop the gitignored build output
COPY --from=build --chown=node:node /repo/apps/web/build ./build
USER node
EXPOSE 3000
CMD ["node", "node_modules/@react-router/serve/bin.cjs", "./build/server/index.js"]
