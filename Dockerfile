FROM oven/bun:latest

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Create tmp directories
RUN mkdir -p /tmp/data /tmp/media

# Set environment variables for Hugging Face
ENV DATA_DIR=/tmp/data
ENV MEDIA_DIR=/tmp/media

# Run the bot
CMD ["bun", "run", "src/index.ts"]
