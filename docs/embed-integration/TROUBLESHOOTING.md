# Troubleshooting

Common issues and their solutions.

## Authentication Errors

### `invalid_embed_session_token`

**Cause**: The token is malformed, expired, or the signature doesn't match.

**Solutions**:

1. **Token expired** — Default TTL is 15 min. Issue a fresh token:
   ```bash
   curl -X POST https://api.athom.io/embed-sessions \
     -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"ttl_seconds": 900}'
   ```

2. **Token from wrong environment** — Sandbox tokens don't work against production and vice versa.

3. **Copy-paste error** — Tokens are `base64url.base64url`. Ensure no whitespace or truncation.

---

### `embed_origin_not_allowed`

**Cause**: The request's `Origin` header doesn't match the token's `allowed_origin`.

**Solutions**:

1. **Check your origin** — Open DevTools Console and verify:
   ```javascript
   console.log("Page origin:", window.location.origin);
   // Must match the allowed_origin you set when issuing the token
   ```

2. **Local development** — If testing from `http://localhost:3000`, set:
   ```json
   { "allowed_origin": "http://localhost:3000" }
   ```

3. **Port mismatch** — `https://example.com` and `https://example.com:3000` are different origins.

4. **Protocol mismatch** — `http://` and `https://` are different origins.

5. **Skip origin binding** (dev only) — Don't pass `allowed_origin` when issuing the token. Note: Transactional scopes require origin binding in production.

---

### `embed_scope_insufficient`

**Cause**: The token doesn't have permission for the requested operation.

**Solutions**:

1. **Check token scopes** — Ensure you're requesting the right scopes when issuing:
   ```json
   {
     "scopes": [
       "checkout:start",
       "checkout:chat",
       "offers:apply",
       "payment:intents:create"
     ]
   }
   ```

2. **Scope required per endpoint**:
   | Endpoint | Required Scope |
   |----------|---------------|
   | `POST /embed/start` | `checkout:start` |
   | `POST /embed/chat` | `checkout:chat` |
   | `POST /embed/track` | `checkout:track` |
   | `POST /embed/offers/apply` | `offers:apply` |
   | `POST /embed/payment/intents` | `payment:intents:create` |

---

### `missing_embed_issuer_context`

**Cause**: Your backend request to `/embed-sessions` is missing or has an invalid API key.

**Solutions**:

1. **Check API key header**:
   ```bash
   # Correct
   -H "Authorization: Bearer sk_live_abc123"
   # Also accepted
   -H "X-AACP-API-Key: sk_live_abc123"
   ```

2. **Verify key is active** — Check the Athom Console for key status.

3. **Environment mismatch** — Live keys won't work on sandbox and vice versa.

---

## CORS Issues

### `Access-Control-Allow-Origin` errors

**Cause**: Browser is blocking cross-origin requests from the widget.

**Solutions**:

1. **Widget doesn't need CORS config** — The widget runs inside an iframe and uses its own embed token. CORS should be handled server-side by the Athom API.

2. **Your backend token endpoint** — If your frontend calls your own backend for a token:
   ```javascript
   // Express
   app.use("/api/embed-token", cors({
     origin: "https://checkout.example.com",
     methods: ["POST"]
   }));
   ```

3. **Preflight requests** — Ensure your server handles `OPTIONS` requests.

---

### `Mixed Content` warnings

**Cause**: Loading HTTP resources on an HTTPS page.

**Solution**: Ensure `api-url` uses HTTPS:
```html
<!-- Wrong -->
<zyon-checkout-agent api-url="http://api.athom.io" ... />

<!-- Correct -->
<zyon-checkout-agent api-url="https://api.athom.io" ... />
```

---

## Widget Not Appearing

### Widget doesn't render

**Check**:

1. **Script loaded?**
   ```javascript
   // Check if the web component is registered
   console.log(customElements.get("zyon-checkout-agent"));
   // Should NOT be undefined
   ```

2. **Token is set?**
   ```javascript
   const widget = document.querySelector("zyon-checkout-agent");
   console.log("Token:", widget?.getAttribute("session-token"));
   // Should not be null/empty
   ```

3. **Script tag present?**
   ```html
   <script src="https://cdn.athom.io/widget/latest/embed.umd.js"></script>
   ```

4. **CSP blocking?** — Check Console for `Content-Security-Policy` errors. Add:
   ```
   script-src 'self' https://cdn.athom.io;
   frame-src 'self' https://*.athom.io;
   connect-src 'self' https://api.athom.io;
   ```

---

### Widget renders but shows blank

1. **Check network tab** — Are requests to `/embed/start` succeeding?
2. **Check session-token** — Is it expired?
3. **Check merchant-id** — Does it match your API key's merchant?

---

## Payment Issues

### Pix QR code not showing

1. **Check scope** — Token must have `payment:intents:create`
2. **Check amount** — Cart total must be > 0
3. **Sandbox mode?** — Pix QR codes are simulated in sandbox

### Card payment failing

1. **Test cards** (sandbox):
   - Success: `4000 0000 0000 0000`
   - Decline: `4000 0000 0000 0002`
   - Insufficient: `4000 0000 0000 9995`

2. **Production**: Ensure your merchant payment gateway is configured in the Athom Console.

---

## postMessage Not Received

### Completion event never fires

1. **Origin check** — The widget sends `postMessage` to the `store-url` attribute. Verify it matches your page's origin exactly:
   ```javascript
   // Widget sends to store-url
   // Your page listens from that origin
   window.addEventListener("message", (event) => {
     console.log("Message from:", event.origin);
     console.log("Data:", event.data);
   });
   ```

2. **Event listener timing** — Add the listener BEFORE the widget mounts, not after:
   ```javascript
   // Register listener first
   window.addEventListener("message", handleMessage);
   // Then set token on widget
   widget.setAttribute("session-token", token);
   ```

3. **Iframe sandbox** — If you're embedding in a sandboxed iframe, ensure `allow-same-origin` is set.

---

## Debug Mode

Enable verbose logging for development:

```javascript
// In browser console
localStorage.setItem("AACP_DEBUG", "true");
location.reload();
```

This will log:
- Token validation attempts
- API requests and responses
- postMessage events sent to parent
- Trigger evaluations
- Session state changes

Disable when done:
```javascript
localStorage.removeItem("AACP_DEBUG");
```

---

## Dev Bypass (Local Development)

For local development without a real token:

1. Set in your API `.env`:
   ```
   EMBED_DEV_BYPASS=true
   MERCHANT_ID=mrc_dev_seed
   ```

2. Use bypass token:
   ```html
   <zyon-checkout-agent
     session-token="__dev_bypass__"
     api-url="http://localhost:3000"
     store-url="http://localhost:5173"
     merchant-id="mrc_dev_seed">
   </zyon-checkout-agent>
   ```

3. Optionally set merchant header:
   ```bash
   curl -X POST http://localhost:3000/embed/start \
     -H "X-AACP-Embed-Token: __dev_bypass__" \
     -H "X-Dev-Merchant-Id: mrc_dev_seed" \
     -H "Content-Type: application/json" \
     -d '{"session_id": "test_123", "cart_items": [...]}'
   ```

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using `session_token` instead of `session-token` | Web component attributes are kebab-case |
| Putting API key in frontend code | Only use API key server-side to issue tokens |
| Not setting `store-url` | Required for secure postMessage delivery |
| Expired token | Issue fresh tokens; set TTL based on your session duration |
| Missing HTTPS in production | All production URLs must use HTTPS |
| Token issued without scopes | The widget can't do anything without scopes |
| Hardcoding token in HTML | Tokens expire; always fetch from backend |

---

## Support

If none of the above solves your issue:

1. **Check status**: [https://status.athom.io](https://status.athom.io)
2. **Collect info**: Browser, OS, error message, network trace
3. **Email**: [support@athom.io](mailto:support@athom.io)
4. **Console debug output**: Copy `AACP_DEBUG=true` logs
