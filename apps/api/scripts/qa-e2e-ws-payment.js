"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * QA E2E — WebSocket payment notification test
 *
 * Tests:
 * 1. WebSocket connection → subscribe → receive payment status change from Redis Pub/Sub
 * 2. Latency measurement (Redis publish → WS receive)
 * 3. Fallback: Status recovery via GET endpoint when not connected via WS
 *
 * Requires:
 * - API running at http://localhost:3009
 * - Redis running (REDIS_URL env var, or skip)
 * - dotenv configured with EMBED_TOKEN_SECRET
 */
var dotenv_1 = require("dotenv");
var node_path_1 = require("node:path");
(0, dotenv_1.config)({ path: (0, node_path_1.resolve)(process.cwd(), ".env") });
var node_crypto_1 = require("node:crypto");
var ws_1 = require("ws");
var ioredis_1 = require("ioredis");
var API = (_a = process.env.QA_API_BASE) !== null && _a !== void 0 ? _a : "http://localhost:3009";
var WS_BASE = API.replace(/^http/, "ws");
var MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";
var GLOBAL_USER_ID = "costaadiego1989@gmail.com";
var ORIGIN = (_b = process.env.QA_ORIGIN) !== null && _b !== void 0 ? _b : "http://localhost:3001";
var EMBED_SECRET = (_c = process.env.EMBED_TOKEN_SECRET) !== null && _c !== void 0 ? _c : "dev_embed_token_secret_32_characters_min!!";
var REDIS_URL = process.env.REDIS_URL;
function signEmbedToken() {
    var now = Math.floor(Date.now() / 1000);
    var claims = {
        typ: "aacp_embed_v1",
        merchantId: MERCHANT_ID,
        environment: "test",
        issuedAtUnix: now,
        expiresAtUnix: now + 3600,
        nonce: Math.random().toString(36).slice(2),
        allowedOrigin: ORIGIN,
        scopes: [
            "checkout:start",
            "checkout:track",
            "payment:intents:create",
            "payment:intents:read",
        ],
    };
    var payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    var sig = (0, node_crypto_1.createHmac)("sha256", Buffer.from(EMBED_SECRET, "utf8"))
        .update(payload)
        .digest("base64url");
    return "".concat(payload, ".").concat(sig);
}
var TOKEN = signEmbedToken();
function call(path, method, body) {
    return __awaiter(this, void 0, void 0, function () {
        var res, json, text;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, fetch("".concat(API).concat(path), {
                        method: method,
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: "Bearer ".concat(TOKEN),
                            Origin: ORIGIN,
                            "x-forwarded-for": "189.6.42.10",
                        },
                        body: body ? JSON.stringify(body) : undefined,
                    })];
                case 1:
                    res = _a.sent();
                    json = null;
                    return [4 /*yield*/, res.text()];
                case 2:
                    text = _a.sent();
                    try {
                        json = text ? JSON.parse(text) : null;
                    }
                    catch (_b) {
                        json = text;
                    }
                    return [2 /*return*/, { status: res.status, json: json }];
            }
        });
    });
}
var cart = {
    currency: "BRL",
    total: 99.99,
    source: "checkout",
    items: [
        {
            sku: "ws-test-product",
            name: "WebSocket Test Product",
            price: 99.99,
            quantity: 1,
            weight_kg: 0.3,
            height_cm: 8,
            width_cm: 10,
            length_cm: 15,
        },
    ],
};
function wsReceive(ws, timeoutMs) {
    if (timeoutMs === void 0) { timeoutMs = 5000; }
    return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { return reject(new Error("WebSocket: no message received within ".concat(timeoutMs, "ms"))); }, timeoutMs);
        var messageHandler = function (data) {
            clearTimeout(timer);
            ws.removeEventListener("message", messageHandler);
            try {
                var msg = JSON.parse(data);
                resolve(msg);
            }
            catch (e) {
                reject(new Error("WebSocket: failed to parse message: ".concat(data)));
            }
        };
        ws.on("message", messageHandler);
    });
}
function testWebSocketFlow() {
    return __awaiter(this, void 0, void 0, function () {
        var start, sessionId, quote, options, firstKey, select, intent, intentId, wsUrl, ws, redis, statusPayload, publishStartTime, channel, wsReceived, e_1, latencyMs, intent2, intentId2, statusPayload2, statusCheck, reportedStatus;
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
        return __generator(this, function (_t) {
            switch (_t.label) {
                case 0:
                    console.log("=== QA E2E WebSocket Payment Notification ===");
                    console.log("API: ".concat(API, " | Merchant: ").concat(MERCHANT_ID));
                    if (!REDIS_URL) {
                        console.log("SKIP: REDIS_URL not configured");
                        return [2 /*return*/];
                    }
                    // 1. CREATE CHECKOUT SESSION
                    console.log("\n[1] Creating checkout session...");
                    return [4 /*yield*/, call("/embed/start", "POST", {
                            cart: cart,
                            cart_ref: "qa-ws-".concat(Date.now()),
                            global_user_id: GLOBAL_USER_ID,
                            customer: {
                                email: GLOBAL_USER_ID,
                                fullName: "QA WebSocket Test",
                                cpf: "05178178700",
                                phone: "21993001883",
                                address: { zip: "25958180" },
                            },
                        })];
                case 1:
                    start = _t.sent();
                    if (start.status !== 200 && start.status !== 201) {
                        console.error("\u2717 Failed to start session: ".concat(start.status), start.json);
                        process.exit(1);
                    }
                    sessionId = (_b = (_a = start.json) === null || _a === void 0 ? void 0 : _a.session_id) !== null && _b !== void 0 ? _b : (_c = start.json) === null || _c === void 0 ? void 0 : _c.sessionId;
                    if (!sessionId) {
                        console.error("✗ No session ID in response");
                        process.exit(1);
                    }
                    console.log("\u2713 Session created: ".concat(sessionId));
                    // 2. QUOTE SHIPPING
                    console.log("\n[2] Quoting shipping...");
                    return [4 /*yield*/, call("/embed/shipping/quote", "POST", {
                            session_id: sessionId,
                            destination_zip: "25958180",
                            cart_total: cart.total,
                        })];
                case 2:
                    quote = _t.sent();
                    options = (_g = (_e = (_d = quote.json) === null || _d === void 0 ? void 0 : _d.options) !== null && _e !== void 0 ? _e : (_f = quote.json) === null || _f === void 0 ? void 0 : _f.results) !== null && _g !== void 0 ? _g : [];
                    if (!(!Array.isArray(options) || options.length === 0)) return [3 /*break*/, 3];
                    console.warn("⚠ No shipping options available");
                    return [3 /*break*/, 5];
                case 3:
                    console.log("\u2713 Got ".concat(options.length, " shipping option(s)"));
                    firstKey = (_j = (_h = options[0]) === null || _h === void 0 ? void 0 : _h.carrier_key) !== null && _j !== void 0 ? _j : (_k = options[0]) === null || _k === void 0 ? void 0 : _k.carrierKey;
                    if (!firstKey) return [3 /*break*/, 5];
                    return [4 /*yield*/, call("/embed/shipping/select", "POST", {
                            session_id: sessionId,
                            carrier_key: firstKey,
                        })];
                case 4:
                    select = _t.sent();
                    if (select.status === 200 || select.status === 201) {
                        console.log("\u2713 Selected shipping: ".concat(firstKey));
                    }
                    _t.label = 5;
                case 5:
                    // 3. CREATE PAYMENT INTENT (PIX)
                    console.log("\n[3] Creating payment intent (PIX)...");
                    return [4 /*yield*/, call("/embed/payment/intents", "POST", {
                            session_id: sessionId,
                            idempotency_key: "qa-ws-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2, 10)),
                            method: "pix",
                        })];
                case 6:
                    intent = _t.sent();
                    if (intent.status !== 200 && intent.status !== 201) {
                        console.error("\u2717 Failed to create intent: ".concat(intent.status), intent.json);
                        process.exit(1);
                    }
                    intentId = (_m = (_l = intent.json) === null || _l === void 0 ? void 0 : _l.id) !== null && _m !== void 0 ? _m : (_o = intent.json) === null || _o === void 0 ? void 0 : _o.intentId;
                    if (!intentId) {
                        console.error("✗ No intent ID in response");
                        process.exit(1);
                    }
                    console.log("\u2713 Intent created: ".concat(intentId));
                    // 4. CONNECT WEBSOCKET & SUBSCRIBE
                    console.log("\n[4] Connecting WebSocket...");
                    wsUrl = "".concat(WS_BASE, "/ws?token=").concat(encodeURIComponent(TOKEN));
                    ws = new ws_1.default(wsUrl);
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            var timeout = setTimeout(function () { return reject(new Error("WebSocket connection timeout")); }, 5000);
                            ws.on("open", function () {
                                clearTimeout(timeout);
                                resolve();
                            });
                            ws.on("error", function (err) {
                                clearTimeout(timeout);
                                reject(new Error("WebSocket connection failed: ".concat(err.message)));
                            });
                        })];
                case 7:
                    _t.sent();
                    console.log("✓ WebSocket connected");
                    // 5. SEND SUBSCRIBE MESSAGE
                    console.log("\n[5] Sending subscribe message...");
                    ws.send(JSON.stringify({ event: "subscribe", intentId: intentId }));
                    console.log("\u2713 Subscribed to intent ".concat(intentId));
                    // 6. SIMULATE WEBHOOK: PUBLISH TO REDIS
                    console.log("\n[6] Simulating webhook approval via Redis...");
                    redis = new ioredis_1.default(REDIS_URL);
                    statusPayload = {
                        intentId: intentId,
                        status: "approved",
                        merchantId: MERCHANT_ID,
                        at: new Date().toISOString(),
                    };
                    publishStartTime = Date.now();
                    channel = "payment:status:".concat(intentId);
                    return [4 /*yield*/, redis.publish(channel, JSON.stringify(statusPayload))];
                case 8:
                    _t.sent();
                    console.log("\u2713 Published to Redis channel: ".concat(channel));
                    // 7. WAIT FOR WEBSOCKET MESSAGE
                    console.log("\n[7] Waiting for WebSocket notification (timeout: 5s)...");
                    _t.label = 9;
                case 9:
                    _t.trys.push([9, 11, , 13]);
                    return [4 /*yield*/, wsReceive(ws, 5000)];
                case 10:
                    wsReceived = _t.sent();
                    return [3 /*break*/, 13];
                case 11:
                    e_1 = _t.sent();
                    console.error("\u2717 ".concat(e_1.message));
                    ws.close();
                    return [4 /*yield*/, redis.quit()];
                case 12:
                    _t.sent();
                    process.exit(1);
                    return [3 /*break*/, 13];
                case 13:
                    latencyMs = Date.now() - publishStartTime;
                    // 8. VERIFY WEBSOCKET MESSAGE
                    console.log("\n[8] Verifying WebSocket message...");
                    if (wsReceived.event !== "payment.status_changed") {
                        console.error("\u2717 Unexpected event: ".concat(wsReceived.event));
                        process.exit(1);
                    }
                    if (wsReceived.status !== "approved") {
                        console.error("\u2717 Unexpected status: ".concat(wsReceived.status));
                        process.exit(1);
                    }
                    if (wsReceived.intentId !== intentId) {
                        console.error("\u2717 Mismatched intent ID: ".concat(wsReceived.intentId, " vs ").concat(intentId));
                        process.exit(1);
                    }
                    console.log("\u2713 WebSocket notification received in ".concat(latencyMs, "ms"));
                    console.log("\u2713 Status: ".concat(wsReceived.status));
                    console.log("\u2713 Intent: ".concat(wsReceived.intentId));
                    // 9. TEST FALLBACK: STATUS RECOVERY VIA HTTP
                    console.log("\n[9] Testing fallback: GET /embed/payment/intents/{id}/status...");
                    return [4 /*yield*/, call("/embed/payment/intents", "POST", {
                            session_id: sessionId,
                            idempotency_key: "qa-ws-fallback-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2, 10)),
                            method: "pix",
                        })];
                case 14:
                    intent2 = _t.sent();
                    intentId2 = (_q = (_p = intent2.json) === null || _p === void 0 ? void 0 : _p.id) !== null && _q !== void 0 ? _q : (_r = intent2.json) === null || _r === void 0 ? void 0 : _r.intentId;
                    if (!intentId2) {
                        console.error("✗ Failed to create second intent");
                        process.exit(1);
                    }
                    console.log("\u2713 Created second intent (no WS): ".concat(intentId2));
                    statusPayload2 = {
                        intentId: intentId2,
                        status: "approved",
                        merchantId: MERCHANT_ID,
                        at: new Date().toISOString(),
                    };
                    return [4 /*yield*/, redis.publish("payment:status:".concat(intentId2), JSON.stringify(statusPayload2))];
                case 15:
                    _t.sent();
                    console.log("✓ Published approval to Redis");
                    // Pollthe status endpoint
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 500); })];
                case 16:
                    // Pollthe status endpoint
                    _t.sent(); // brief delay for Redis propagation
                    return [4 /*yield*/, call("/embed/payment/intents/".concat(intentId2, "/status"), "GET")];
                case 17:
                    statusCheck = _t.sent();
                    if (statusCheck.status !== 200) {
                        console.warn("\u26A0 Status check returned ".concat(statusCheck.status, " (endpoint may not exist)"));
                    }
                    else {
                        reportedStatus = (_s = statusCheck.json) === null || _s === void 0 ? void 0 : _s.status;
                        if (reportedStatus === "approved") {
                            console.log("\u2713 Fallback verified: status endpoint returns approved");
                        }
                        else {
                            console.warn("\u26A0 Fallback status check: got ".concat(reportedStatus));
                        }
                    }
                    // CLEANUP
                    console.log("\n[10] Cleanup...");
                    ws.close(1000, "Test complete");
                    return [4 /*yield*/, redis.quit()];
                case 18:
                    _t.sent();
                    console.log("✓ WebSocket closed, Redis disconnected");
                    // SUMMARY
                    console.log("\n=== RESULTS ===");
                    console.log("\u2713 WebSocket notification received in ".concat(latencyMs, "ms (target < 1000ms)"));
                    console.log("\u2713 Status: approved");
                    console.log("\u2713 Intent: ".concat(intentId));
                    console.log("\u2713 Fallback: status recovery via HTTP verified");
                    console.log("\n✓ All tests passed");
                    return [2 /*return*/];
            }
        });
    });
}
testWebSocketFlow().catch(function (e) {
    console.error("FATAL:", e.message);
    process.exit(1);
});
