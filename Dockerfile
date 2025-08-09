FROM node:18-alpine

# Install Python and build tools for node-pty
RUN apk add --no-cache python3 make g++ git bash

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

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