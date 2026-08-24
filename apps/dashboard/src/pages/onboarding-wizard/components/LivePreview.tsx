import React from "react";
import type { MerchantProfile } from "../../../api-client.js";
import { LivePreviewPanel } from "../../../components/LivePreviewPanel.js";

interface LivePreviewProps {
  apiBaseUrl: string;
  me: MerchantProfile;
}

export function LivePreview({ apiBaseUrl, me }: LivePreviewProps) {
  return (
    <aside className="onb-preview">
      <LivePreviewPanel
        apiBaseUrl={apiBaseUrl}
        me={me}
        presentation="floating"
        hideControls
        width="100%"
      />
    </aside>
  );
}
