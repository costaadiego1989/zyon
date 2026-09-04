# Categories

Organize your product catalog with hierarchical categories.

## Endpoints

### GET /v1/categories

List all categories for the merchant.

**Auth:** `catalog:read`

**Response:**
```json
{
  "data": [
    {
      "category_id": "cat_123",
      "name": "Electronics",
      "description": "Electronic products",
      "parent_id": null,
      "image_url": "https://cdn.example.com/categories/electronics.jpg",
      "is_active": true,
      "sort_order": 1,
      "created_at": "2024-08-01T10:30:00Z"
    }
  ],
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/categories

Create a new category.

**Auth:** `catalog:read` (human principals only)

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Category name |
| description | string | No | Category description |
| parent_id | string | No | Parent category ID for nesting |
| image_url | string | No | Category image |
| is_active | boolean | No | Category status |
| sort_order | number | No | Display order |

**Response:**
```json
{
  "data": {
    "category_id": "cat_abc",
    "name": "New Category",
    "is_active": true,
    "sort_order": 0,
    "created_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/categories/:id

Get category details.

**Auth:** `catalog:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Category ID |

**Response:**
```json
{
  "data": {
    "category_id": "cat_123",
    "name": "Electronics",
    "description": "Electronic products",
    "parent_id": null,
    "image_url": "https://cdn.example.com/categories/electronics.jpg",
    "is_active": true,
    "sort_order": 1
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### PATCH /v1/categories/:id

Update a category.

**Auth:** `catalog:read` (human principals only)

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | No | Category name |
| description | string | No | Category description |
| parent_id | string | No | Parent category ID |
| image_url | string | No | Category image |
| is_active | boolean | No | Category status |
| sort_order | number | No | Display order |

**Response:**
```json
{
  "data": {
    "category_id": "cat_123",
    "name": "Electronics",
    "is_active": true,
    "updated_at": "2024-08-18T10:35:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:35:00Z",
    "version": "v1"
  }
}
```

### DELETE /v1/categories/:id

Delete a category.

**Auth:** `catalog:read` (human principals only)

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Category ID |

**Response:**
```json
{
  "data": {
    "deleted": true,
    "category_id": "cat_123"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### PUT /v1/categories/reorder

Reorder multiple categories.

**Auth:** `catalog:read` (human principals only)

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| category_orders | array | Yes | Array of category order updates |
| category_orders[].category_id | string | Yes | Category ID |
| category_orders[].position | number | Yes | New sort order |

**Response:**
```json
{
  "data": {
    "reordered": true,
    "updated_count": 3
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```
