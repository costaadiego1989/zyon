FROM php:8.2-apache

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libfreetype6-dev \
    libjpeg62-turbo-dev \
    libpng-dev \
    libicu-dev \
    libxml2-dev \
    libxslt1-dev \
    libzip-dev \
    libonig-dev \
    libsodium-dev \
    unzip \
    git \
    curl \
    cron \
    default-mysql-client \
    && rm -rf /var/lib/apt/lists/*

# Install PHP extensions required by Magento
RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
    bcmath \
    gd \
    intl \
    mbstring \
    pdo_mysql \
    soap \
    sockets \
    sodium \
    xsl \
    zip \
    opcache

# PHP config for Magento
RUN echo "memory_limit=2G" > /usr/local/etc/php/conf.d/magento.ini \
    && echo "max_execution_time=1800" >> /usr/local/etc/php/conf.d/magento.ini \
    && echo "realpath_cache_size=10M" >> /usr/local/etc/php/conf.d/magento.ini \
    && echo "realpath_cache_ttl=7200" >> /usr/local/etc/php/conf.d/magento.ini

# Enable Apache modules
RUN a2enmod rewrite headers expires

# Apache config
RUN sed -i 's|/var/www/html|/var/www/html/pub|g' /etc/apache2/sites-available/000-default.conf \
    && echo '<Directory /var/www/html/pub>\n    AllowOverride All\n    Require all granted\n</Directory>' >> /etc/apache2/sites-available/000-default.conf

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Configure Magento Composer auth
RUN mkdir -p /var/www/.composer \
    && echo '{"http-basic":{"repo.magento.com":{"username":"c0a0c517a74f54972c5c836a390b4b58","password":"76fcb1f973ccd3ff80d6165619128820"}}}' > /var/www/.composer/auth.json \
    && chown -R www-data:www-data /var/www/.composer

# Install entrypoint script
COPY docker/magento/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /var/www/html

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
CMD ["apache2-foreground"]
