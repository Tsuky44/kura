FROM oven/bun:1

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for caching
COPY package.json bun.lock ./

# Install dependencies
RUN bun install

# Copy source code
COPY . .

# Create directory for movies and database if they don't exist
RUN mkdir -p /app/movies /app/data

# Expose port
EXPOSE 3089

# Start the application
CMD ["bun", "run", "src/index.ts"]
