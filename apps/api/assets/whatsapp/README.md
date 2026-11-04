# WhatsApp presentation assets

The five current states are welcome-v2, cart-added-v1, cart-empty-v1, payment-paid-v1 and order-shipped-v1. Each has its original MP4, a genuine animated GIF export and a looping 512 × 512 animated WebP sticker. WebP assets are 22–44 KB and use the Cloud API `sticker` payload without a caption. Ordinary MP4 messages require the client's video player; GIF files are available as exports rather than disguised as supported Cloud API video. Autoplay remains subject to the recipient client and settings.

Conversions preserve the existing artwork, at 12 fps, with FFmpeg 9.0.2: WebP uses libwebp_anim, quality 60, compression 6 and loop 0; GIF uses palettegen (128 colors), paletteuse (bayer, scale 3) and loop 0. The public closed allowlist serves image/webp and image/gif with immutable caching. Change versioned filenames whenever artwork changes.

Animation is supplemental. The readable message and native actions remain the primary interface. A cart success requires a confirmed canonical addition, payment success requires the approved order/receipt and shipping requires the shipped state. Existing immutable delivery claims prevent unknown provider acceptance from being resent.

`welcome-v1.mp4`: original 3-second silent greeting, 720 × 720, rendered locally with HyperFrames 0.8.214. No external pictures, logo, customer information or commercial state. The readable text message and native menu remain the primary interface. The clip appears once per conversation, on greeting or an explicit visit to Menu.

Editable composition and pinned project commands are in `source/`. The public API route exposes this one versioned file; it accepts no file path or merchant argument. Re-render and version the filename if the content changes.
