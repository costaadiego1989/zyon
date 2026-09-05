local cjson = require "cjson"

local function env(name, fallback)
  local value = os.getenv(name)
  if value == nil or value == "" then return fallback end
  return value
end

local function positive_number(name, fallback)
  local value = tonumber(env(name, tostring(fallback)))
  assert(value and value > 0 and value == math.floor(value), name .. " must be a positive integer")
  return value
end

local function csv(value)
  local result = {}
  for item in value:gmatch("[^,]+") do
    result[#result + 1] = item:match("^%s*(.-)%s*$")
  end
  return result
end

local origins = csv(env("GATEWAY_CORS_ORIGINS", "http://localhost:3000,http://localhost:3001,http://localhost:5174,http://localhost:5175"))
local policy = env("GATEWAY_RATE_LIMIT_POLICY", "local")
assert(policy == "local" or policy == "redis", "GATEWAY_RATE_LIMIT_POLICY must be local or redis")

local function rate_limit(minute, hour)
  local config = {
    minute = minute, hour = hour, policy = policy, limit_by = "ip",
    fault_tolerant = false, hide_client_headers = false,
  }
  if policy == "redis" then
    config.redis = {
      host = assert(env("GATEWAY_REDIS_HOST"), "GATEWAY_REDIS_HOST is required"),
      port = positive_number("GATEWAY_REDIS_PORT", 6379),
      database = tonumber(env("GATEWAY_REDIS_DATABASE", "1")),
      password = env("GATEWAY_REDIS_PASSWORD"),
      timeout = 2000,
    }
  end
  return { name = "rate-limiting", config = config }
end

local config = {
  _format_version = "3.0",
  services = {{
    name = "zyon-api",
    protocol = "http",
    host = env("UPSTREAM_API_HOST", "host.docker.internal"),
    port = positive_number("UPSTREAM_API_PORT", 3009),
    connect_timeout = 5000, read_timeout = 180000, write_timeout = 30000,
    -- Avoid replaying payment/webhook requests after an upstream failure.
    retries = 0,
    routes = {
      { name = "api-readiness", paths = { "~/(?:v1/)?(?:health|ready)$" }, regex_priority = 100, strip_path = false, preserve_host = true },
      {
        name = "api-auth", paths = { "~/(?:v1/)?auth(?:/|$)" }, regex_priority = 50,
        strip_path = false, preserve_host = true,
        plugins = { rate_limit(positive_number("GATEWAY_AUTH_MINUTE", 30), positive_number("GATEWAY_AUTH_HOUR", 300)) },
      },
      {
        name = "api-public", paths = { "/" }, strip_path = false, preserve_host = true,
        plugins = { rate_limit(positive_number("GATEWAY_RATE_MINUTE", 120), positive_number("GATEWAY_RATE_HOUR", 3600)) },
      },
    },
  }},
  plugins = {
    {
      name = "cors",
      config = {
        origins = origins, credentials = true, max_age = 3600,
        methods = { "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD" },
        headers = { "Content-Type", "Authorization", "Idempotency-Key", "If-Match", "If-None-Match", "X-Request-Id", "x-aacp-api-key", "x-correlation-id", "x-aacp-embed-token", "x-aacp-event-id", "x-aacp-event-type", "x-aacp-timestamp", "x-aacp-signature" },
        exposed_headers = { "ETag", "Idempotency-Replayed", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After" },
      },
    },
    { name = "request-size-limiting", config = { allowed_payload_size = 10 } },
  },
}

local output = assert(io.open(env("KONG_DECLARATIVE_CONFIG", "/tmp/kong-declarative.json"), "w"))
output:write(cjson.encode(config))
output:close()
