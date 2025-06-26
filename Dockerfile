# Base image: Node.js 22 on Alpine
FROM node:22-alpine

# Install bash (optional) — you can skip this if you don't need bash inside container
RUN apk add --no-cache bash git

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /app

RUN git config --global --add safe.directory /app

# Copy dependency files first (for Docker caching)
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the rest of the source code after dependencies are installed
COPY . .

# Default command — no build at image build time
# You will run `pnpm build` at runtime via docker-compose
CMD ["bash"]
