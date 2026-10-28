import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Package only the verified static app outputs, never another monorepo surface.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const team = "team_580RxQPCo0VLxu9vdZdJgb1S";
for (const [app, project] of [["control", "prj_X68tcS3nwLbLemZPPGxut067fWmv"], ["dashboard", "prj_ExtCipEsyn65zIa2cg6FbUbugR3E"]]) {
  const source = path.join(root, "apps", app, "dist");
  if (!existsSync(path.join(source, "index.html"))) throw new Error(`build_missing:${app}`);
  const html = readFileSync(path.join(source, "index.html"), "utf8");
  if (!html.includes("/assets/")) throw new Error(`invalid_app_artifact:${app}`);
  const target = path.join(root, ".audit/billing-promotions-deploy/20261015", app);
  const output = path.join(target, ".vercel/output");
  mkdirSync(output, { recursive: true });
  if (app === "dashboard") mkdirSync(path.join(target, "apps/dashboard"), { recursive: true });
  cpSync(source, path.join(output, "static"), { recursive: true });
  writeFileSync(path.join(output, "config.json"), JSON.stringify({ version: 3,
    routes: [{ handle: "filesystem" }, { src: "/.*", dest: "/index.html" }] }));
  writeFileSync(path.join(target, ".vercel/project.json"), JSON.stringify({ projectId: project, orgId: team, projectName: `zyon-${app}` }));
  console.log(JSON.stringify({ app, package: target, project, production: false }));
}

// The existing Railway homolog hostname keeps its established CAPTCHA/OAuth
// allowlists. Upload this generated, secret-free bundle with --path-as-root.
const railwayTarget = path.join(root, ".audit/billing-promotions-deploy/20261015/railway-dashboard");
const appTarget = path.join(railwayTarget, "apps/dashboard");
mkdirSync(appTarget, { recursive: true });
cpSync(path.join(root, "apps/dashboard/dist"), path.join(appTarget, "dist"), { recursive: true });
cpSync(path.join(root, "apps/dashboard/nginx.conf"), path.join(appTarget, "nginx.conf"));
writeFileSync(path.join(appTarget, "Dockerfile"), [
  "FROM nginxinc/nginx-unprivileged:1.27-alpine",
  "USER root",
  "RUN rm -f /etc/nginx/conf.d/default.conf",
  "COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf",
  "COPY --chown=nginx:nginx apps/dashboard/dist /usr/share/nginx/html",
  "USER nginx",
  "EXPOSE 8080",
  'CMD ["nginx", "-g", "daemon off;"]', "",
].join("\n"));
console.log(JSON.stringify({ app: "dashboard", railwayPackage: railwayTarget, production: false }));
