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

# Runtime libraries stay installed. The *-dev packages are only needed to compile the PHP extensions,
# so they go in a throw-away virtual group. (Deleting a -dev package on Alpine also deletes the runtime
# library it pulled in — e.g. libpq for pdo_pgsql — which leaves the extension unable to load and shows
# up at deploy time as "could not find driver".)
RUN apk add --no-cache \
        bash \
        curl \
        git \
        nginx \
        supervisor \
        sqlite \
        sqlite-libs \
        libpq \
        icu-libs \
        libzip \
        oniguruma \
    && apk add --no-cache --virtual .build-deps \
        icu-dev \
        libzip-dev \
        oniguruma-dev \
        sqlite-dev \
        postgresql-dev \
    && docker-php-ext-install \
        bcmath \
        intl \
        pcntl \
        pdo_mysql \
        pdo_pgsql \
        pdo_sqlite \
        zip \
        opcache \
    && apk del --no-cache .build-deps

# Fail the BUILD (not the deploy) if an extension can't load.
RUN php -r 'foreach (["pdo_pgsql", "pdo_mysql", "pdo_sqlite", "intl", "zip", "bcmath"] as $e) { if (!extension_loaded($e)) { fwrite(STDERR, "PHP extension failed to load: $e\n"); exit(1); } }'

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
