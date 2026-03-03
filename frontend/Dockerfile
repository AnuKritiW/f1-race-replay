FROM node:20-alpine

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json* ./

RUN npm install

# Copy the rest of the source
COPY . .

EXPOSE 5173

# --host 0.0.0.0 is required so the Vite dev server is reachable from outside
# the container (Docker maps the port from the host to this address)
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
