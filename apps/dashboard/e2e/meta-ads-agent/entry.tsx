import React from "react";
import {createRoot} from "react-dom/client";
import "../../src/styles.css";
import {MetaAdsAgentPage} from "../../src/pages/meta-ads-agent/index.js";
document.body.style.cssText = "overflow:auto;height:auto;padding:24px";
document.getElementById("root")!.style.cssText = "height:auto;overflow:visible;min-width:0";
createRoot(document.getElementById("root")!).render(<MetaAdsAgentPage merchantId="store-a" apiBaseUrl="http://127.0.0.1:3018"/>);
