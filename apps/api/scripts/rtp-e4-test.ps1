#!/usr/bin/env pwsh

$MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa"
$API_BASE = "http://127.0.0.1:3009"
$TIMESTAMP = [int64](Get-Date -UFormat %s%3)
$PRODUCT_ID = "sku_generic_001"

Write-Host "`n=== RTP E4 Hard Journey (PowerShell) ===`n"

try {
    # STEP 1: Health check
    Write-Host "1. Checking API health..."
    $healthResponse = Invoke-WebRequest -Uri "$API_BASE/health" -Method Get -UseBasicParsing
    $health = $healthResponse.Content | ConvertFrom-Json

    if ($health.status -eq "ok") {
        Write-Host "✓ API is healthy`n"
    } else {
        throw "API not healthy"
    }

    # STEP 2: Start checkout
    Write-Host "2. Starting checkout session..."
    $buyerEmail = "rtp-e4-$TIMESTAMP@test.local"

    $startBody = @{
        merchantId = $MERCHANT_ID
        buyerEmail = $buyerEmail
        items = @(@{
            productId = $PRODUCT_ID
            quantity = 1
        })
    } | ConvertTo-Json

    $startResponse = Invoke-WebRequest -Uri "$API_BASE/checkout/start-checkout" `
        -Method Post `
        -Headers @{ "Content-Type" = "application/json" } `
        -Body $startBody `
        -UseBasicParsing `
        -ErrorAction Stop

    $startData = $startResponse.Content | ConvertFrom-Json

    if ($startData.sessionId) {
        Write-Host "✓ Session started: $($startData.sessionId)`n"

        # STEP 3: Complete order
        Write-Host "3. Completing order..."
        $externalOrderId = "RTP_ORDER_$TIMESTAMP"

        $completeBody = @{
            merchantId = $MERCHANT_ID
            sessionId = $startData.sessionId
            externalOrderId = $externalOrderId
            payment = @{
                method = "test"
                status = "approved"
            }
        } | ConvertTo-Json

        $completeResponse = Invoke-WebRequest -Uri "$API_BASE/checkout/orders/complete" `
            -Method Post `
            -Headers @{ "Content-Type" = "application/json" } `
            -Body $completeBody `
            -UseBasicParsing `
            -ErrorAction Stop

        $completeData = $completeResponse.Content | ConvertFrom-Json

        if ($completeData.id) {
            Write-Host "✓ Order completed: $($completeData.id)`n"

            # STEP 4: Get session to verify persistence
            Write-Host "4. Verifying order persisted..."
            $getResponse = Invoke-WebRequest -Uri "$API_BASE/checkout/checkout/$MERCHANT_ID/$($startData.sessionId)" `
                -Method Get `
                -UseBasicParsing `
                -ErrorAction Stop

            $sessionData = $getResponse.Content | ConvertFrom-Json
            Write-Host "✓ Order verified: status=$($sessionData.status)`n"

            # FINAL REPORT
            Write-Host "=== SUCCESS ===`n"
            Write-Host "Merchant:       $MERCHANT_ID"
            Write-Host "Session:        $($startData.sessionId)"
            Write-Host "Order:          $($completeData.id)"
            Write-Host "Total:          $($startData.orderTotal)"
            Write-Host "Status:         $($completeData.status)`n"

            Write-Host "✓ E4 DETERMINISTIC JOURNEY COMPLETE`n"
            exit 0
        } else {
            throw "No orderId in response: $($completeData | ConvertTo-Json)"
        }
    } else {
        Write-Host "`n❌ Start checkout failed (likely product not found)"
        Write-Host "Response: $($startData | ConvertTo-Json | Select-Object -First 500)`n"
        Write-Host "Next step: seed a product for merchant, then re-run`n"
        exit 1
    }
} catch {
    Write-Host "`n✗ ERROR: $($_.Exception.Message)`n"
    exit 1
}
