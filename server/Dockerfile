FROM node:22-slim

# Install build tools needed for better-sqlite3 (native module)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# SQLite database lives on a persistent Fly volume mounted at /data
ENV DB_PATH=/data/hilton.db

EXPOSE 3000

CMD ["node", "index.js"]
