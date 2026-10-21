type AnalyticsParams = Record<string, string | number | boolean>;

let lastTrackedPagePath: string | null = null;

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

export function trackPageView(pagePath: string) {
  if (lastTrackedPagePath === pagePath) return;
  lastTrackedPagePath = pagePath;
  trackEvent("page_view", {
    page_path: pagePath,
    page_location: `${window.location.origin}${pagePath}`,
    page_title: document.title,
  });
}
