# syntax=docker/dockerfile:1.7
#
# Dashboard static-asset image. Builds the Vite app locally (host) and ships
# only the compiled `dist/` to a slim nginx image. No node_modules needed.
#
# Host build: `pnpm --filter @zyon/dashboard build` before `docker compose up`.

FROM nginx:1.27-alpine
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/dashboard/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
