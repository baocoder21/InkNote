# The InkNote web image: the built Angular app served by nginx, which also forwards /api and /hubs to the API.
# Build from THIS folder:  docker build -t inknote-web src/frontend

# ---- stage 1: build the app (Node is only needed here) ----
FROM node:24-alpine AS build
WORKDIR /app
ENV NG_CLI_ANALYTICS=false

# Packages first (cached while package-lock.json does not change), then the source.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# "container" = the production build with a RELATIVE API address (see angular.json and DECISIONS).
RUN npx ng build --configuration container

# ---- stage 2: serve it ----
# The "unprivileged" nginx image runs as a normal user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
EXPOSE 8080
