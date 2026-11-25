import type { RasterSourceSpecification, StyleSpecification } from "maplibre-gl";

export const OPENFREEMAP_POSITRON_STYLE = "https://tiles.openfreemap.org/styles/positron";

export const FEMA_NFHL_SOURCE_ID = "fema-nfhl";
export const FEMA_NFHL_LAYER_ID = "fema-nfhl-overlay";

export const OPENFREEMAP_GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

export const RASTER_STREET_STYLE: StyleSpecification = {
  version: 8,
  glyphs: OPENFREEMAP_GLYPHS_URL,
  sources: {
    "usgs-topo": {
      type: "raster",
      tiles: [
        "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 16,
      attribution: "U.S. Geological Survey (The National Map)",
    },
  },
  layers: [
    {
      id: "usgs-topo-tiles",
      type: "raster",
      source: "usgs-topo",
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

export const AERIAL_IMAGERY_STYLE: StyleSpecification = {
  version: 8,
  glyphs: OPENFREEMAP_GLYPHS_URL,
  sources: {
    "usgs-imagery": {
      type: "raster",
      tiles: [
        "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 16,
      attribution: "U.S. Geological Survey (The National Map)",
    },
  },
  layers: [
    {
      id: "usgs-imagery-tiles",
      type: "raster",
      source: "usgs-imagery",
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

export const FEMA_NFHL_OVERLAY_SOURCE: RasterSourceSpecification = {
  type: "raster",
  tiles: [
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=png32&transparent=true&layers=show:28&f=image",
  ],
  tileSize: 512,
  minzoom: 12,
  maxzoom: 19,
  attribution: "FEMA National Flood Hazard Layer (NFHL)",
};
