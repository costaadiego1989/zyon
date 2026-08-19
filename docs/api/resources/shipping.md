# Shipping

Get shipping quotes for customer destinations.

## Endpoints

### POST /v1/shipping/quotes

Get available shipping options for a cart and destination.

**Auth:** `checkout:read`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| session_id | string | Yes | Checkout session ID |
| destination_zip | string | Yes | Delivery ZIP code |
| cart_total | number | Yes | Cart total in minor units (cents) |
| origin_zip | string | No | Origin ZIP code |
| packages | array | No | Package dimensions |
| packages[].weight_kg | number | Yes | Weight in kilograms |
| packages[].height_cm | number | Yes | Height in centimeters |
| packages[].width_cm | number | Yes | Width in centimeters |
| packages[].length_cm | number | Yes | Length in centimeters |
| packages[].quantity | number | Yes | Number of packages |
| items | array | No | Cart items for calculation |

**Response:**
```json
{
  "data": {
    "quotes": [
      {
        "carrier": "sedex",
        "carrier_name": "Correios Sedex",
        "service_code": "04014",
        "delivery_days": 3,
        "price": 2500,
        "currency": "BRL"
      },
      {
        "carrier": "pac",
        "carrier_name": "Correios PAC",
        "service_code": "04510",
        "delivery_days": 8,
        "price": 1200,
        "currency": "BRL"
      }
    ],
    "origin_zip": "01310-100",
    "destination_zip": "22041-060"
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
curl -X POST https://api.aacp.dev/v1/shipping/quotes \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "sess_xyz",
    "destination_zip": "22041-060",
    "cart_total": 9990,
    "packages": [
      {
        "weight_kg": 1.5,
        "height_cm": 10,
        "width_cm": 20,
        "length_cm": 30,
        "quantity": 1
      }
    ]
  }'
```
