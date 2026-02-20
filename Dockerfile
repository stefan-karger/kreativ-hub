# =============================================================================
# Build stage: install deps with pnpm and produce the Nitro .output bundle
# =============================================================================

# 24 - latest LTE / slim - uses glibc
FROM node:24-slim AS builder

# enable corepack and install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# start with the dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# copy the rest
COPY . .

RUN pnpm run build

# =============================================================================
# Production stage: minimal image that only runs the built server
# =============================================================================

FROM node:24-slim AS production

WORKDIR /app

# create a simple user
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

# copy over the output from the builder
COPY --from=builder /app/.output ./.output

# set permissions for the user
RUN chown -R app:app /app
USER app

# might help some packages optimize
ENV NODE_ENV=production

# needs to be the port used inside the application
EXPOSE 3000

# start the application
CMD ["node", ".output/server/index.mjs"]
