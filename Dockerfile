# syntax=docker/dockerfile:1

# ---- Stage 1: build frontend assets (Vite + TS) ----
FROM node:20-alpine AS node-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Stage 2: PHP dependencies ----
FROM composer:2 AS composer-build
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --ignore-platform-reqs
COPY . .
RUN composer dump-autoload --optimize --no-dev

# ---- Stage 3: runtime image (nginx + php-fpm under supervisord) ----
FROM php:8.3-fpm-alpine AS app

RUN apk add --no-cache \
        bash \
        curl \
        git \
        nginx \
        supervisor \
        sqlite \
        icu-dev \
        libzip-dev \
        oniguruma-dev \
    && docker-php-ext-install \
        bcmath \
        intl \
        pcntl \
        pdo_mysql \
        pdo_sqlite \
        zip \
        opcache \
    && apk del --no-cache icu-dev libzip-dev oniguruma-dev

WORKDIR /var/www/html

COPY . .
COPY --from=composer-build /app/vendor ./vendor
COPY --from=node-build /app/public/build ./public/build

COPY docker/php/opcache.ini /usr/local/etc/php/conf.d/opcache.ini
COPY docker/nginx/default.conf /etc/nginx/http.d/default.conf
COPY docker/supervisord.conf /etc/supervisord.conf
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

RUN chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache /var/www/html/public \
    && mkdir -p /run/nginx

EXPOSE 80

ENTRYPOINT ["entrypoint.sh"]
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
