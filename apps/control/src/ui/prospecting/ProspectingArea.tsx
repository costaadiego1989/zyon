import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PlatformApiError,
  type PlatformApi,
  type PlatformOperator,
} from "../../lib/api.js";
import { ProspectingShell } from "./ProspectingShell.js";
import { ProspectingOverview } from "./ProspectingOverview.js";
import { ProspectingChannelPage } from "./ProspectingChannelPage.js";
import { SalesKnowledgePage } from "./SalesKnowledgePage.js";
import { ProspectingInbox } from "./ProspectingInbox.js";
import { CampaignDetailPage } from "./CampaignDetailPage.js";
import { CampaignWorkspace } from "./CampaignWorkspace.js";
import { ProspectDetailPage } from "./ProspectDetailPage.js";
import { CompanySearchPage } from "./CompanySearchPage.js";
import { ProspectingPrivacyPage } from "./ProspectingPrivacyPage.js";

type Props = {
  api: PlatformApi;
  token: string;
  operator: PlatformOperator;
  onSessionExpired: () => void;
};
export function ProspectingArea({
  api,
  token,
  operator,
  onSessionExpired,
}: Props) {
  const client = useMemo(() => api.prospectingClient(token), [api, token]);
  const own = useMemo(
    () => ({ id: operator.operator_id, label: operator.email }),
    [operator.operator_id, operator.email]
  );
  const [operators, setOperators] = useState([own]);
  useEffect(() => {
    let live = true;
    async function load() {
      const eligible = new Map([[own.id, own]]);
      let cursor: string | undefined;
      do {
        const page = await api.listOperators(token, {
          status: "active",
          role: "platform_admin",
          cursor,
          limit: 100,
        });
        for (const entry of page.items)
          if (
            entry.status === "active" &&
            entry.permissions.includes("platform:prospecting:write")
          )
            eligible.set(entry.operator_id, {
              id: entry.operator_id,
              label: entry.email,
            });
        cursor = page.next_cursor ?? undefined;
      } while (live && cursor);
      if (live) setOperators([...eligible.values()]);
    }
    void load().catch((error) => {
      if (live) {
        setOperators([own]);
        if (error instanceof PlatformApiError && error.status === 401)
          onSessionExpired();
      }
    });
    return () => {
      live = false;
    };
  }, [api, token, own, onSessionExpired]);
  const loadConfig = useCallback(
    (signal: AbortSignal) => client.config(signal),
    [client]
  );
  return (
    <ProspectingShell
      loadConfig={loadConfig}
      onSessionExpired={onSessionExpired}
      renderArea={(route, navigate, config) => {
        const props = {
          api: client,
          operatorId: operator.operator_id,
          navigate,
          onSessionExpired,
        };
        switch (route.area) {
          case "overview":
            return <ProspectingOverview {...props} route={route} />;
          case "companies":
            return <CompanySearchPage {...props} />;
          case "leads":
            return (
              <ProspectDetailPage
                {...props}
                route={route}
                operators={operators}
              />
            );
          case "campaigns":
            return route.filters?.view === "edit" ? (
              <CampaignWorkspace {...props} id={route.id} />
            ) : (
              <CampaignDetailPage {...props} id={route.id} />
            );
          case "conversations":
            return (
              <ProspectingInbox
                {...props}
                route={route}
                operators={operators}
              />
            );
          case "knowledge":
            return (
              <SalesKnowledgePage {...props} modelMode={config.modelMode} />
            );
          case "channel":
            return (
              <ProspectingChannelPage {...props} mode={config.dispatchMode} />
            );
          case "privacy":
            return <ProspectingPrivacyPage {...props} />;
        }
      }}
    />
  );
}
