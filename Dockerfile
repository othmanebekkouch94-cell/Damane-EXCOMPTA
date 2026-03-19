FROM node:22-alpine

WORKDIR /app

# Backend deps
COPY package*.json ./
RUN npm ci --production

# Frontend build
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Backend source
COPY backend/ ./backend/
COPY .env.example ./.env

# Uploads dir
RUN mkdir -p uploads

EXPOSE 3001

CMD ["node", "backend/server.js"]
