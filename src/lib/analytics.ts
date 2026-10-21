type AnalyticsParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    gtag?: (command: "event", eventName: string, params?: AnalyticsParams) => void;
  }
}

export function trackEvent(eventName: string, params: AnalyticsParams = {}) {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/")) return;
  if (typeof window.gtag === "function") window.gtag("event", eventName, params);
}
