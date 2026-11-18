import type { StyleSpecification } from "maplibre-gl";

export const OPENFREEMAP_POSITRON_STYLE = "https://tiles.openfreemap.org/styles/positron";

export const RASTER_STREET_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "carto-positron": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      ],
      tileSize: 256,
      attribution: "OpenStreetMap contributors · CARTO",
    },
  },
  layers: [
    {
      id: "carto-positron-tiles",
      type: "raster",
      source: "carto-positron",
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

export const AERIAL_IMAGERY_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    aerial: {
      type: "raster",
      tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "Esri, USGS, USDA NAIP",
    },
  },
  layers: [
    {
      id: "aerial-tiles",
      type: "raster",
      source: "aerial",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};
