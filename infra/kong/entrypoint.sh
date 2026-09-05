#!/bin/sh
set -eu
resty /etc/kong/render-config.lua
exec /docker-entrypoint.sh "$@"
