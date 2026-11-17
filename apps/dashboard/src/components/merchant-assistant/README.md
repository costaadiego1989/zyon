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
