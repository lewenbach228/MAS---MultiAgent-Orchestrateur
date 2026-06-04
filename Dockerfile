FROM node:22-alpine
WORKDIR /app

# Backend dependencies
COPY package.json package-lock.json ./
RUN npm install

# Dashboard dependencies + build
COPY dashboard/package.json dashboard/package-lock.json* ./dashboard/
RUN cd dashboard && npm install

# Source code
COPY . .
RUN cd dashboard && npm run build
