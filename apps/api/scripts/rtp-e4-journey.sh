#!/bin/bash

# RTP E4 Hard Journey - Checkout Order & Metrics Verification
# Uses curl for API calls and direct DB queries

set -e

MERCHANT_ID="mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa"
API_BASE="http://127.0.0.1:3009"
TIMESTAMP=$(date +%s%N)

echo "=== RTP E4 HARD JOURNEY START ==="
echo ""

# STEP 1: Query active product from DB
echo "STEP 1: Query active product from DB..."
DB_URL="${DATABASE_URL}"

if [ -z "$DB_URL" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

# Query product using psql
PRODUCT_DATA=$(PGPASSWORD=$(echo $DB_URL | grep -oP '(?<=:)[^@]*(?=@)' | cut -d: -f2) psql -h $(echo $DB_URL | grep -oP '(?://)([^:@/]+)' | tr -d '/') -U $(echo $DB_URL | grep -oP '(?://)[^:]*' | tr -d '/') -d $(echo $DB_URL | grep -oP '(?:\/)[^?]*$' | tr -d '/') -t -c "SELECT id, name, price, cost FROM products WHERE merchant_id='$MERCHANT_ID' LIMIT 1;" 2>/dev/null | head -1)

if [ -z "$PRODUCT_DATA" ]; then
  echo "ERROR: No products found for merchant $MERCHANT_ID"
  exit 1
fi

PRODUCT_ID=$(echo "$PRODUCT_DATA" | awk '{print $1}')
PRODUCT_NAME=$(echo "$PRODUCT_DATA" | awk '{print $2}')
PRICE=$(echo "$PRODUCT_DATA" | awk '{print $3}')
COST=$(echo "$PRODUCT_DATA" | awk '{print $4}')

echo "✓ Found product: id=$PRODUCT_ID, name=$PRODUCT_NAME, price=$PRICE, cost=$COST"
echo ""

# STEP 2: Start checkout session
echo "STEP 2: Start checkout session via API..."
BUYER_EMAIL="rtp-e4-$TIMESTAMP@test.local"

START_RESPONSE=$(curl -s -X POST "$API_BASE/checkout/start-checkout" \
  -H "Content-Type: application/json" \
  -d "{
    \"merchantId\": \"$MERCHANT_ID\",
    \"buyerEmail\": \"$BUYER_EMAIL\",
    \"items\": [{\"productId\": \"$PRODUCT_ID\", \"quantity\": 1}]
  }")

SESSION_ID=$(echo "$START_RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
ORDER_TOTAL=$(echo "$START_RESPONSE" | grep -o '"orderTotal":[0-9.]*' | cut -d':' -f2)

if [ -z "$SESSION_ID" ]; then
  echo "ERROR: Failed to start checkout"
  echo "$START_RESPONSE"
  exit 1
fi

echo "✓ Checkout started: sessionId=$SESSION_ID, orderTotal=$ORDER_TOTAL"
echo ""

# STEP 3: Complete order
echo "STEP 3: Complete order via API..."
EXTERNAL_ORDER_ID="RTP_ORDER_$TIMESTAMP"

COMPLETE_RESPONSE=$(curl -s -X POST "$API_BASE/checkout/orders/complete" \
  -H "Content-Type: application/json" \
  -d "{
    \"merchantId\": \"$MERCHANT_ID\",
    \"sessionId\": \"$SESSION_ID\",
    \"externalOrderId\": \"$EXTERNAL_ORDER_ID\",
    \"payment\": {\"method\": \"test\", \"status\": \"approved\"}
  }")

ORDER_ID=$(echo "$COMPLETE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
ORDER_STATUS=$(echo "$COMPLETE_RESPONSE" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$ORDER_ID" ]; then
  echo "ERROR: Failed to complete order"
  echo "$COMPLETE_RESPONSE"
  exit 1
fi

echo "✓ Order completed: id=$ORDER_ID, status=$ORDER_STATUS"
echo ""

# STEP 4: Verify order persisted
echo "STEP 4: Verify order in DB..."
ORDER_DATA=$(PGPASSWORD=$(echo $DB_URL | grep -oP '(?<=:)[^@]*(?=@)' | cut -d: -f2) psql -h $(echo $DB_URL | grep -oP '(?://)([^:@/]+)' | tr -d '/') -U $(echo $DB_URL | grep -oP '(?://)[^:]*' | tr -d '/') -d $(echo $DB_URL | grep -oP '(?:\/)[^?]*$' | tr -d '/') -t -c "SELECT order_total, status FROM completed_orders WHERE id='$ORDER_ID';" 2>/dev/null)

DB_TOTAL=$(echo "$ORDER_DATA" | awk '{print $1}')
DB_STATUS=$(echo "$ORDER_DATA" | awk '{print $2}')

if [ -z "$DB_TOTAL" ]; then
  echo "ERROR: Order not found in DB"
  exit 1
fi

echo "✓ Order persisted: total=$DB_TOTAL, status=$DB_STATUS"
echo ""

# STEP 5: Verify metrics
echo "STEP 5: Verify metrics updated..."
COUNT_BEFORE=$(PGPASSWORD=$(echo $DB_URL | grep -oP '(?<=:)[^@]*(?=@)' | cut -d: -f2) psql -h $(echo $DB_URL | grep -oP '(?://)([^:@/]+)' | tr -d '/') -U $(echo $DB_URL | grep -oP '(?://)[^:]*' | tr -d '/') -d $(echo $DB_URL | grep -oP '(?:\/)[^?]*$' | tr -d '/') -t -c "SELECT COUNT(*) FROM completed_orders WHERE merchant_id='$MERCHANT_ID';" 2>/dev/null | tr -d ' ')

TOTAL_REVENUE=$(PGPASSWORD=$(echo $DB_URL | grep -oP '(?<=:)[^@]*(?=@)' | cut -d: -f2) psql -h $(echo $DB_URL | grep -oP '(?://)([^:@/]+)' | tr -d '/') -U $(echo $DB_URL | grep -oP '(?://)[^:]*' | tr -d '/') -d $(echo $DB_URL | grep -oP '(?:\/)[^?]*$' | tr -d '/') -t -c "SELECT SUM(order_total)::numeric FROM completed_orders WHERE merchant_id='$MERCHANT_ID';" 2>/dev/null | tr -d ' ')

echo "✓ Metrics: orders_count=$COUNT_BEFORE, total_revenue=$TOTAL_REVENUE"
echo ""

# FINAL REPORT
echo "=== RTP E4 HARD JOURNEY COMPLETE ==="
echo ""
echo "SUMMARY:"
echo "  Seed product:     id=$PRODUCT_ID, price=$PRICE, cost=$COST"
echo "  Order created:    id=$ORDER_ID, total=$DB_TOTAL, status=$DB_STATUS"
echo "  Metrics:          orders_count=$COUNT_BEFORE, total_revenue=$TOTAL_REVENUE"
echo ""
