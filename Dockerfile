FROM node:22-alpine

# Install build dependencies for node-pty
RUN apk update && apk add --no-cache \
    python3 \
    make \
    g++ \
    gcc \
    bash \
    linux-headers \
    libc-dev

# Create Python symlink for node-gyp
RUN ln -sf python3 /usr/bin/python

# Install latest Git from edge repository
RUN apk add --no-cache git --repository=http://dl-cdn.alpinelinux.org/alpine/edge/main

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Set environment variables for building native modules
ENV PYTHON=/usr/bin/python3

# Install all dependencies
RUN npm install

# Rebuild node-pty for Alpine Linux
RUN npm rebuild node-pty || echo "node-pty rebuild completed with warnings"

# Install AI CLI tools globally
RUN npm install -g \
    @anthropic-ai/claude-code \
    @openai/codex \
    @google/gemini-cli

# Create client directory and install client dependencies
RUN mkdir client
COPY client/package*.json ./client/
RUN cd client && npm install

# Copy application code
COPY . .

# Build client
RUN cd client && npm run build

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 3000

# Start the server
CMD ["npm", "start"]
