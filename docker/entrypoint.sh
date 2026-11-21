#!/bin/bash
set -e

if [ ! -f /var/www/html/.env ]; then
    cp /var/www/html/.env.example /var/www/html/.env
fi

# Skip when APP_KEY is already set as a real environment variable (e.g. Render's dashboard) —
# key:generate refuses to run in that case ("APP_KEY is already present in the environment"),
# since it only knows how to persist a new key into the .env file, not the platform's env store.
if [ -z "${APP_KEY:-}" ] && [ -z "$(grep -E '^APP_KEY=.+' /var/www/html/.env 2>/dev/null || true)" ]; then
    php /var/www/html/artisan key:generate --force
fi

# Wait for the database before migrating (DB container can take a moment to accept connections).
if [ "${DB_CONNECTION}" = "mysql" ] || [ "${DB_CONNECTION}" = "pgsql" ]; then
    echo "Waiting for database at ${DB_HOST}:${DB_PORT}..."
    # Back off between attempts: hammering a pooler with failed logins can trip its circuit breaker
    # ("too many authentication failures") and lock the app out for minutes.
    for i in $(seq 1 8); do
        if php /var/www/html/artisan db:show > /dev/null 2>&1; then
            break
        fi
        sleep $((i * 3))
    done
fi

php /var/www/html/artisan migrate --force
php /var/www/html/artisan config:cache
php /var/www/html/artisan route:cache
php /var/www/html/artisan view:cache
php /var/www/html/artisan storage:link || true

# The artisan commands above run as root. Anything they log would leave a root-owned
# laravel.log that php-fpm (www-data) can't append to, giving "Permission denied" 500s after deploy.
mkdir -p /var/www/html/storage/logs
touch /var/www/html/storage/logs/laravel.log
chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache

exec "$@"
