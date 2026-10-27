'use client';

import Script from 'next/script';

export function FacebookPixel({ pixelId }: { pixelId?: string }) {
  if (!pixelId) return null;
  if (!/^\d{10,20}$/.test(pixelId)) return null;

  const fbqScript = `
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');fbq('init', '${pixelId}');fbq('track', 'PageView');
  `;

  return (
    <>
      <Script
        id="fb-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: fbqScript }}
      />
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}

export function TiktokPixel({ pixelId }: { pixelId?: string }) {
  if (!pixelId) return null;
  if (!/^[A-Z0-9]{10,30}$/i.test(pixelId)) return null;

  const ttScript = `
    !function (w, d, t) {
      w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
      ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],
      ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
      for(var i=0;i<ttq.methods.length;++i)ttq.setAndDefer(ttq,ttq.methods[i]);
      ttq.instance=function(t){for(var e=ttq._i[t]||[],a=0;a<e.length;a++)e[a](ttq);
      return ttq._i[t]=e,ttq},ttq.load=function(e,t){var a="https://analytics.tiktok.com/i18n/pixel/events.js";
      ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e].push(t),
      ttq._t=ttq._t||{},ttq._t[e]=new Image,ttq._t[e].src=a+"?sdkid="+e+"&lib="+t};
      ttq.load('${pixelId}','tiktok_analytics');ttq.page();
    }(window, document, 'ttq');
  `;

  return (
    <>
      <Script
        id="tt-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: ttScript }}
      />
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          src={`https://t.tiktok.com/i/pixel/events/?sdkid=${pixelId}`}
        />
      </noscript>
    </>
  );
}
