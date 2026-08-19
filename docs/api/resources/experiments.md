# Experiments

Run A/B tests on checkout agent behavior with traffic-splitting variants and performance tracking.

## Endpoints

### GET /v1/experiments

List all experiments for the merchant.

**Auth:** `experiments:read`

**Response:**
```json
{
  "data": [
    {
      "experiment_id": "exp_123",
      "name": "Tone of Voice Test",
      "description": "Testing friendly vs formal tone",
      "status": "running",
      "variants": [
        {
          "id": "var_abc",
          "name": "Friendly Tone",
          "weight": 50,
          "is_control": true
        },
        {
          "id": "var_def",
          "name": "Formal Tone",
          "weight": 50,
          "is_control": false
        }
      ],
      "created_at": "2024-08-01T10:30:00Z",
      "started_at": "2024-08-01T12:00:00Z"
    }
  ],
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/experiments

Create a new experiment.

**Auth:** `experiments:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Experiment name |
| description | string | No | Experiment description |
| variants | array | Yes | Array of variants (min 2) |
| variants[].id | string | No | Variant ID (for updates) |
| variants[].name | string | Yes | Variant name |
| variants[].system_prompt | string | Yes | Agent system prompt |
| variants[].weight | number | Yes | Traffic weight (0-100, all must sum to 100) |
| variants[].is_control | boolean | Yes | Whether this is the control group |

**Response:**
```json
{
  "data": {
    "experiment_id": "exp_new",
    "name": "Tone of Voice Test",
    "status": "draft",
    "variants": [
      {
        "id": "var_abc",
        "name": "Friendly Tone",
        "weight": 50,
        "is_control": true
      },
      {
        "id": "var_def",
        "name": "Formal Tone",
        "weight": 50,
        "is_control": false
      }
    ],
    "created_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

**cURL Example:**
```bash
curl -X POST https://api.aacp.dev/v1/experiments \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Tone of Voice Test",
    "variants": [
      {
        "name": "Friendly Tone",
        "system_prompt": "You are a friendly sales assistant...",
        "weight": 50,
        "is_control": true
      },
      {
        "name": "Formal Tone",
        "system_prompt": "You are a professional advisor...",
        "weight": 50,
        "is_control": false
      }
    ]
  }'
```

### GET /v1/experiments/:id

Get experiment details with current state.

**Auth:** `experiments:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Experiment ID |

**Response:**
```json
{
  "data": {
    "experiment_id": "exp_123",
    "name": "Tone of Voice Test",
    "description": "Testing friendly vs formal tone",
    "status": "running",
    "variants": [...],
    "created_at": "2024-08-01T10:30:00Z",
    "started_at": "2024-08-01T12:00:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### PATCH /v1/experiments/:id

Update experiment name, description, or variants (only allowed in draft status).

**Auth:** `experiments:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | No | Experiment name |
| description | string | No | Experiment description |
| variants | array | No | Updated variants (min 2, weights must sum to 100) |

### POST /v1/experiments/:id/start

Start a draft experiment (begins traffic splitting).

**Auth:** `experiments:write`

**Response:**
```json
{
  "data": {
    "experiment_id": "exp_123",
    "status": "running",
    "started_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/experiments/:id/stop

Stop a running experiment.

**Auth:** `experiments:write`

**Response:**
```json
{
  "data": {
    "experiment_id": "exp_123",
    "status": "stopped",
    "stopped_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/experiments/:id/archive

Archive a stopped experiment.

**Auth:** `experiments:write`

**Response:**
```json
{
  "data": {
    "experiment_id": "exp_123",
    "status": "archived",
    "archived_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/experiments/:id/results

Get experiment performance results and statistical analysis.

**Auth:** `experiments:read`

**Response:**
```json
{
  "data": {
    "experiment_id": "exp_123",
    "status": "running",
    "duration_days": 17,
    "total_sessions": 2500,
    "variants": [
      {
        "id": "var_abc",
        "name": "Friendly Tone",
        "sessions": 1250,
        "conversion_rate": 24.5,
        "revenue": 305625,
        "average_order": 99900,
        "is_control": true
      },
      {
        "id": "var_def",
        "name": "Formal Tone",
        "sessions": 1250,
        "conversion_rate": 18.2,
        "revenue": 227500,
        "average_order": 99780,
        "is_control": false
      }
    ],
    "winner": "var_abc",
    "confidence": 95.2,
    "significant": true
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/experiments/:id/promote

Promote the winning variant as the new default agent behavior.

**Auth:** `experiments:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| variant_id | string | Yes | Winning variant ID to promote |

**Response:**
```json
{
  "data": {
    "experiment_id": "exp_123",
    "promoted_variant_id": "var_abc",
    "status": "archived",
    "promoted_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```
