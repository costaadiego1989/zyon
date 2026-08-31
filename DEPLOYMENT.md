# Deployment Guide — Railway + CI/CD

## Architecture

```
GitHub → CI Gate (typecheck/lint/test/build)
  ↓
  ├─ Branch: staging  → Deploy to Railway staging env
  └─ Tag: v*          → Deploy to Railway production env
```

### Services

| Service | Type | Port | Docker | Config |
|---------|------|------|--------|--------|
| **api** | NestJS backend | 3009 | apps/api/Dockerfile | railway-api.json |
| **dashboard** | React Vite → Nginx | 80 | apps/dashboard/Dockerfile | railway-dashboard.json |
| **storefront** | Next.js | 3001 | apps/storefront/Dockerfile | railway-storefront.json |
| **postgres** | Database | 5432 | Railway plugin | auto-provisioned |
| **redis** | Cache/sessions | 6379 | Railway plugin | auto-provisioned |

**widget**: Vite library (not deployed to Railway). Exported as ESM/IIFE, served from CDN or static host.

---

## Setup

### 1. GitHub Secrets

Add to repo → Settings → Secrets → Actions:

```
RAILWAY_TOKEN          # From railway.com/dashboard → Account → API Tokens
```

### 2. Railway Project Structure

Create 2 Railway environments in your project:

- **staging**: auto-deploy from `staging` branch
- **production**: triggered by version tags (v1.0.0, v1.0.1, etc.)

Each environment has isolated:
- Services (api-staging, dashboard-staging, etc.)
- Environment variables (.env per env)
- Databases (separate PostgreSQL + Redis)

### 3. Environment Variables

#### Staging (`.env.staging`)

```env
# General
NODE_ENV=staging
LOG_LEVEL=debug

# API
DATABASE_URL=postgresql://user:pass@postgres-staging:5432/zyon_staging
REDIS_URL=redis://redis-staging:6379
JWT_SECRET=<generate-secure-random-staging>
OPENAI_API_KEY=<your-staging-key>
DEEPSEEK_API_KEY=<optional>

# Storefront
NEXT_PUBLIC_API_BASE_URL=https://api-staging.yourdom.com
NEXT_PUBLIC_WIDGET_BASE_URL=https://widget-staging.yourdom.com

# Dashboard
VITE_API_URL=https://api-staging.yourdom.com
```

#### Production (`.env.production`)

```env
# General
NODE_ENV=production
LOG_LEVEL=info

# API
DATABASE_URL=postgresql://user:pass@postgres-prod:5432/zyon_prod
REDIS_URL=redis://redis-prod:6379
JWT_SECRET=<generate-secure-random-prod>
OPENAI_API_KEY=<your-prod-key>
DEEPSEEK_API_KEY=<your-prod-key>

# Storefront
NEXT_PUBLIC_API_BASE_URL=https://api.yourdom.com
NEXT_PUBLIC_WIDGET_BASE_URL=https://widget.yourdom.com

# Dashboard
VITE_API_URL=https://api.yourdom.com
```

---

## Deployment Flow

### Staging Deployment (Blue-Green via `staging` branch)

```bash
git checkout -b feature/my-feature
# ... make changes ...
git commit -m "feat(checkout): add new feature"
git push origin feature/my-feature

# CI runs automatically:
# - typecheck ✓
# - lint ✓
# - test ✓
# - build ✓
# ✅ All pass

# Create PR, review, approve
git push origin feature/my-feature
# → GitHub Actions CI workflow runs

# Once approved + CI ✓, merge to staging
git checkout staging
git merge feature/my-feature
git push origin staging

# → GitHub Actions deploy workflow triggers
# → Stages all services to Railway staging env
# → Each service auto-scales (numReplicas: 2)
# → Health checks verify readiness
```

**Access staging:**
- API: https://api-staging.yourdom.com
- Dashboard: https://dashboard-staging.yourdom.com
- Storefront: https://storefront-staging.yourdom.com

### Production Deployment (via version tags)

```bash
# After staging validation, release to production:
git checkout main
git merge staging
git tag v1.0.0
git push origin main --tags

# → GitHub Actions deploy workflow triggers
# → Stages all services to Railway production env
# → Automatic monitoring + alerts enabled
```

**Access production:**
- API: https://api.yourdom.com
- Dashboard: https://dashboard.yourdom.com
- Storefront: https://storefront.yourdom.com

---

## Health Checks

### API (TCP port 3009)
```
GET /ready → 200 OK
```

### Dashboard (HTTP GET `/healthz`)
```
nginx stub_status
```

### Storefront (HTTP GET `/`)
```
Next.js default health
```

Railway auto-retries failed services (max 3x). If health check fails 3 times, deployment rolls back.

---

## Rollback

If production deploy goes bad, Railway keeps the previous deployment active:

```bash
# In Railway dashboard:
1. Go to Deployments tab
2. Select the previous stable deployment
3. Click "Promote to latest" → instant atomic rollback
```

Or via CLI:

```bash
railway deploy --from-image <previous-image-id> --service api --environment production
```

---

## Monitoring

- **Railway dashboard**: https://railway.app/dashboard
- **Logs**: `railway logs --service api --environment production`
- **Metrics**: CPU, memory, network in Railway UI
- **Alerts**: Configure in Railway project settings

---

## CI/CD Workflow Details

### When CI Fails

If any step fails (typecheck, lint, test, build), the deployment is **blocked**:

1. GitHub PR shows ❌ CI failed
2. Merge to staging/prod blocked (branch protection rules)
3. Fix the issue, push again, CI re-runs
4. Merge only after ✓ all checks pass

### When Deploy Fails

If Railway deploy fails:

1. GitHub Actions logs show the error
2. Railway automatic rollback happens (previous deployment stays live)
3. Investigate + fix + tag new version
4. Push tag → deploy retries

---

## Local Development

```bash
# Build Docker images locally
docker build -f apps/api/Dockerfile -t zyon-api:dev .
docker build -f apps/dashboard/Dockerfile -t zyon-dashboard:dev .
docker build -f apps/storefront/Dockerfile -t zyon-storefront:dev .

# Run docker-compose with all services
docker-compose -f docker-compose.monitoring.yml up -d
docker-compose -f docker-compose.kong.yml up -d

# Or use Railway CLI to connect to staging DB
railway link  # Links to your Railway project
railway run npm run prisma:migrate:dev
```

---

## Troubleshooting

### "railway up" command not found
```bash
npm install -g @railway/cli
railway login
```

### Health check timeout
Check service logs:
```bash
railway logs --service api --environment staging
```

### Database migration issues in production
```bash
railway exec -s api -- npm run prisma:deploy --environment production
```

### Environment variable not found
1. Verify in Railway dashboard → Service → Variables
2. Redeploy service to apply new variables
3. Check variable name matches `.env.*` file

---

## Next Steps

1. Set up Railway project + environments
2. Configure GitHub secrets (`RAILWAY_TOKEN`)
3. Add domain + SSL via Railway domains
4. Set up monitoring + alerts
5. Train team on git flow (feature → staging → prod)
