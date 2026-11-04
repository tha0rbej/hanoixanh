(function attachVietnamTerritoryLabels(global) {
  const territories = [
    { latitude: 16.5, longitude: 112.0, name: "Quần đảo Hoàng Sa" },
    { latitude: 10.0, longitude: 114.0, name: "Quần đảo Trường Sa" }
  ];

  function addTo(map) {
    const leaflet = global.L;
    if (!map || !leaflet?.marker || !leaflet?.divIcon) return [];

    const markers = territories.map((territory) => {
      const icon = leaflet.divIcon({
        className: "hnx-vietnam-territory-label",
        html: `<span class="hnx-vietnam-territory-label__content">${territory.name}</span>`,
        iconSize: [156, 34],
        iconAnchor: [78, 17]
      });

      return leaflet.marker([territory.latitude, territory.longitude], {
        icon,
        interactive: false,
        keyboard: false,
        zIndexOffset: 1000
      }).addTo(map);
    });

    const updateVisibility = () => {
      const visible = typeof map.getZoom !== "function" || map.getZoom() <= 11;
      markers.forEach((marker) => marker.setOpacity?.(visible ? 1 : 0));
    };
    map.on?.("zoomend", updateVisibility);
    updateVisibility();

    return markers;
  }

  global.HanoiXanhVietnamMap = { addTo, territories };
})(window);
