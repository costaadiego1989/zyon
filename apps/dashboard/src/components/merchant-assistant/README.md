# Shared merchant assistant UI

`ChatDock` keeps conversation presentation separate from the agent's tools and permissions. Use `presentation="floating"` for the compact Zyon mascot launcher. The default inline presentation remains available.

```tsx
<ChatDock
  key={merchantId}
  presentation="floating"
  context={authorizedContext}
  pageKey={`${merchantId}:${page}`}
  hints={pageHints}
  turns={turns}
  expanded={open}
  onExpandedChange={setOpen}
  onSend={submitAuthorizedTurn}
/>
```

Mount once for the active merchant. Changing merchants must replace the conversation scope, pending requests and component key. Changing `pageKey` updates only the helpful tips; it does not authorize tools or change the backend agent context. The integration that owns the global engine must supply its authorized conversation and actions.

Tips are local strings, shown every ten seconds while closed and visible. They never call a model or submit a message. A dismissal hides the current visit's tips; opening the panel or changing context resets the cycle. Pass an empty stable array to suppress tips during a financial review. Keyboard collapse/reopen preserves the draft and restores focus. `ZyonAgentOrb` provides the existing storefront sphere/eyes with reduced-motion support.

The advertising module supplies its own tips and existing conversation/approval services. No page guidance or launcher click constitutes approval for a campaign or a configuration change.

Keep host-page button resets outside `.chat-dock` so the launcher stays circular and the hint keeps readable foreground/background colors. Advertising acceptance checks this in a real browser. Required financial review closes the panel and suppresses tips until review ends. The mascot sits above the existing support button on the right, without moving support. Panel height accounts for this reserved bottom space on short phone screens.

The floating panel is390px on desktop and fits the viewport with12px side margins on small phones. Escape collapses it and restores launcher focus; reopening focuses the composer without discarding a draft. Visual review uses the actual advertising module at1440,390 and320px; data and external deliveries are controlled locally.
