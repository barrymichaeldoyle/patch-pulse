# Use an official Node.js runtime as the base image
FROM node:20-bookworm-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Install Python, make, g++ for node-gyp and native builds
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json to the container
COPY package*.json ./

# Install the application's dependencies inside the container
RUN npm ci

# Copy the rest of the application's files to the container
COPY . .

# Build the application
RUN npm run build

# The command to run the application in production mode
CMD ["npm", "run", "start:prod"]
