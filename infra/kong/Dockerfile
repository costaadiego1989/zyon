FROM kong:3.9.1@sha256:76c14b93e989f7f4418039f7f9789ca32564016211c86ac1a18022f4788e7b9c

COPY --chown=kong:kong render-config.lua /etc/kong/render-config.lua
COPY --chown=kong:kong entrypoint.sh /etc/kong/entrypoint.sh

ENV KONG_DATABASE=off \
    KONG_DECLARATIVE_CONFIG=/tmp/kong-declarative.json \
    KONG_PREFIX=/tmp/kong \
    KONG_PROXY_LISTEN=0.0.0.0:8000 \
    KONG_ADMIN_LISTEN=off \
    KONG_ADMIN_GUI_LISTEN=off \
    KONG_STATUS_LISTEN=0.0.0.0:8100 \
    KONG_NGINX_WORKER_PROCESSES=2 \
    KONG_PROXY_ACCESS_LOG=/dev/stdout \
    KONG_PROXY_ERROR_LOG=/dev/stderr \
    KONG_LOG_LEVEL=notice

USER kong
EXPOSE 8000
ENTRYPOINT ["sh", "/etc/kong/entrypoint.sh"]
CMD ["kong", "docker-start"]
