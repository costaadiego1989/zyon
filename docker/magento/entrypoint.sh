#!/bin/bash
set -e

MAGENTO_DIR="/var/www/html"
INSTALL_FLAG="$MAGENTO_DIR/.magento_installed"

# Wait for MySQL
echo "→ Waiting for MySQL..."
until mysqladmin ping -h"$MYSQL_HOST" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --skip-ssl --silent 2>/dev/null; do
  sleep 2
done
echo "✓ MySQL ready"

# Wait for Elasticsearch
echo "→ Waiting for Elasticsearch..."
until curl -sf "http://${ELASTICSEARCH_HOST}:${ELASTICSEARCH_PORT}/_cluster/health" >/dev/null 2>&1; do
  sleep 2
done
echo "✓ Elasticsearch ready"

# Install Magento if not already installed
if [ ! -f "$INSTALL_FLAG" ]; then
  echo "→ Installing Magento 2 (first run — takes ~5min)..."

  # Create project via Composer
  if [ ! -f "$MAGENTO_DIR/composer.json" ]; then
    echo "  → Running composer create-project..."
    cd /var/www
    # Install to a temp dir first, then move contents (preserving mounted volumes)
    composer create-project --repository-url=https://repo.magento.com/ \
      magento/project-community-edition=2.4.7 magento-src \
      --no-interaction --no-progress 2>&1 | tail -5
    # Move files into html without touching mounted subdirs
    cp -rn magento-src/. html/ 2>/dev/null || true
    cp -rf magento-src/. html/ 2>/dev/null || true
    rm -rf magento-src
    chown -R www-data:www-data html
  fi

  cd "$MAGENTO_DIR"

  # Run Magento setup
  echo "  → Running setup:install..."
  php bin/magento setup:install \
    --base-url="${MAGENTO_BASE_URL}" \
    --db-host="${MYSQL_HOST}" \
    --db-name="${MYSQL_DATABASE}" \
    --db-user="${MYSQL_USER}" \
    --db-password="${MYSQL_PASSWORD}" \
    --admin-firstname="${MAGENTO_ADMIN_FIRSTNAME}" \
    --admin-lastname="${MAGENTO_ADMIN_LASTNAME}" \
    --admin-email="${MAGENTO_ADMIN_EMAIL}" \
    --admin-user="${MAGENTO_ADMIN_USER}" \
    --admin-password="${MAGENTO_ADMIN_PASSWORD}" \
    --language=pt_BR \
    --currency=BRL \
    --timezone=America/Sao_Paulo \
    --use-rewrites=1 \
    --search-engine=elasticsearch7 \
    --elasticsearch-host="${ELASTICSEARCH_HOST}" \
    --elasticsearch-port="${ELASTICSEARCH_PORT}" \
    --backend-frontname=admin \
    --no-interaction 2>&1 | tail -10

  # Disable two-factor auth for local dev
  php bin/magento module:disable Magento_AdminAdobeImsTwoFactorAuth Magento_TwoFactorAuth 2>/dev/null || true

  # Enable Zyon module if present
  if [ -d "$MAGENTO_DIR/app/code/Zyon/Checkout" ]; then
    echo "  → Enabling Zyon_Checkout module..."
    php bin/magento module:enable Zyon_Checkout 2>/dev/null || true
  fi

  # Deploy and compile
  echo "  → Running setup:upgrade..."
  php bin/magento setup:upgrade --no-interaction 2>&1 | tail -3

  echo "  → Setting developer mode..."
  php bin/magento deploy:mode:set developer 2>/dev/null || true

  # Fix permissions
  chown -R www-data:www-data "$MAGENTO_DIR"
  chmod -R 775 "$MAGENTO_DIR/var" "$MAGENTO_DIR/generated" "$MAGENTO_DIR/pub/static" "$MAGENTO_DIR/pub/media"

  touch "$INSTALL_FLAG"
  echo "✓ Magento installed successfully!"
else
  echo "✓ Magento already installed, starting..."
  cd "$MAGENTO_DIR"
fi

# Start Apache
echo "→ Starting Apache..."
exec "$@"
