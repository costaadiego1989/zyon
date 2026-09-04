# Products

Manage your product catalog with full CRUD operations and search.

## Endpoints

### GET /v1/products

List or search products with cursor-based pagination.

**Auth:** `catalog:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| limit | number | No | Page size (default 20, max 100) |
| cursor | string | No | Pagination cursor |
| query | string | No | Search query (name, SKU) |
| category_id | string | No | Filter by category |

**Response:**
```json
{
  "data": [
    {
      "product_id": "prod_123",
      "name": "Product A",
      "sku": "SKU-001",
      "status": "active",
      "base_price_in_cents": 4990,
      "currency": "BRL",
      "stock_quantity": 50,
      "category_id": "cat_abc"
    }
  ],
  "pagination": {
    "next_cursor": "eyJpZCI6InByb2RfMTIzIn0=",
    "has_more": true
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
curl -X GET "https://api.aacp.dev/v1/products?limit=10&query=shirt" \
  -H "Authorization: Bearer aacp_test_..."
```

### GET /v1/products/:id

Get full product details including variants and media.

**Auth:** `catalog:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Product ID |

**Response:**
```json
{
  "data": {
    "product_id": "prod_123",
    "name": "Product A",
    "description": "High-quality product",
    "type": "physical",
    "status": "active",
    "variants": [
      {
        "sku": "SKU-001",
        "name": "Default",
        "base_price_in_cents": 4990,
        "cost_in_cents": 2000,
        "tax_percent": 0,
        "currency": "BRL",
        "stock_quantity": 50,
        "media": []
      }
    ],
    "seo": {
      "meta_title": "Product A",
      "meta_description": "...",
      "slug": "product-a"
    },
    "created_at": "2024-08-01T10:30:00Z",
    "updated_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/products

Create a new product with variants.

**Auth:** `catalog:read` (human principals only)

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Product name |
| description | string | No | Product description |
| type | string | No | Product type (physical, digital) |
| status | string | No | Status (active, draft) |
| category_id | string | No | Category assignment |
| meta_title | string | No | SEO meta title |
| meta_description | string | No | SEO meta description |
| slug | string | No | URL slug |
| og_title | string | No | Open Graph title |
| og_description | string | No | Open Graph description |
| twitter_card | string | No | Twitter card type |
| keywords | string[] | No | SEO keywords |
| variants | array | Yes | Product variants |
| variants[].sku | string | Yes | Unique SKU |
| variants[].name | string | Yes | Variant name |
| variants[].base_price_in_cents | number | Yes | Price in cents |
| variants[].cost_in_cents | number | No | Cost for margin calculation |
| variants[].tax_percent | number | No | Tax percentage |
| variants[].currency | string | Yes | Currency code |
| variants[].stock_quantity | number | Yes | Available stock |
| variants[].media | array | No | Media URLs |

**Response:**
```json
{
  "data": {
    "product_id": "prod_abc",
    "name": "New Product",
    "status": "draft",
    "variants": [
      {
        "sku": "SKU-NEW-001",
        "base_price_in_cents": 9990,
        "stock_quantity": 100
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
curl -X POST https://api.aacp.dev/v1/products \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Product",
    "type": "physical",
    "variants": [
      {
        "sku": "SKU-NEW-001",
        "name": "Default",
        "base_price_in_cents": 9990,
        "currency": "BRL",
        "stock_quantity": 100
      }
    ]
  }'
```

### PATCH /v1/products/:id

Update an existing product's details or SEO fields.

**Auth:** `catalog:read` (human principals only)

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | No | Product name |
| description | string | No | Product description |
| status | string | No | Product status |
| meta_title | string | No | SEO meta title |
| meta_description | string | No | SEO meta description |
| slug | string | No | URL slug |
| og_title | string | No | Open Graph title |
| og_description | string | No | Open Graph description |
| twitter_card | string | No | Twitter card type |
| keywords | string[] | No | SEO keywords |

**Response:**
```json
{
  "data": {
    "product_id": "prod_123",
    "name": "Updated Product",
    "status": "active",
    "updated_at": "2024-08-18T10:35:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:35:00Z",
    "version": "v1"
  }
}
```

### DELETE /v1/products/:id

Delete a product permanently.

**Auth:** `catalog:read` (human principals only)

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Product ID |

**Response:**
```json
{
  "data": {
    "deleted": true,
    "product_id": "prod_123"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```
