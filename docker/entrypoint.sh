#!/bin/bash
set -e

if [ ! -f /var/www/html/.env ]; then
    cp /var/www/html/.env.example /var/www/html/.env
fi

if [ -z "$(grep -E '^APP_KEY=.+' /var/www/html/.env || true)" ]; then
    php /var/www/html/artisan key:generate --force
fi

# Wait for the database before migrating (DB container can take a moment to accept connections).
if [ "${DB_CONNECTION}" = "mysql" ] || [ "${DB_CONNECTION}" = "pgsql" ]; then
    echo "Waiting for database at ${DB_HOST}:${DB_PORT}..."
    for i in $(seq 1 30); do
        if php /var/www/html/artisan db:show > /dev/null 2>&1; then
            break
        fi
        sleep 2
    done
fi

php /var/www/html/artisan migrate --force
php /var/www/html/artisan config:cache
php /var/www/html/artisan route:cache
php /var/www/html/artisan view:cache
php /var/www/html/artisan storage:link || true

exec "$@"
