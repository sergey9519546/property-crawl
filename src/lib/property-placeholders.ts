export type PropertyPlaceholderCategory =
  | "single-family"
  | "manufactured-home"
  | "condo-townhome"
  | "multi-family"
  | "vacant-land"
  | "commercial-industrial"
  | "unclassified-parcel";

export interface PropertyPlaceholderInfo {
  category: PropertyPlaceholderCategory;
  typeLabel: string;
  imageSrc: string;
  alt: string;
  caption: string;
  accentClass: string;
}

const CATEGORY_CONFIG: Record<
  PropertyPlaceholderCategory,
  Omit<PropertyPlaceholderInfo, "category" | "typeLabel" | "alt">
> = {
  "single-family": {
    imageSrc: "/placeholders/single-family.jpg",
    caption: "Single-family placeholder · Check Aerial or Street View",
    accentClass: "border-go/30 bg-go-wash text-go",
  },
  "manufactured-home": {
    imageSrc: "/placeholders/manufactured-home.jpg",
    caption: "Manufactured home placeholder · Check Aerial or Street View",
    accentClass: "border-line-strong bg-paper text-ink-2",
  },
  "condo-townhome": {
    imageSrc: "/placeholders/condo-townhome.jpg",
    caption: "Attached home placeholder · Check Aerial or Street View",
    accentClass: "border-line-strong bg-card/90 text-ink-2",
  },
  "multi-family": {
    imageSrc: "/placeholders/multi-family.jpg",
    caption: "Multi-family placeholder · Check Aerial or Street View",
    accentClass: "border-catch/30 bg-catch-wash text-catch-ink",
  },
  "vacant-land": {
    imageSrc: "/placeholders/vacant-land.jpg",
    caption: "Vacant land parcel placeholder · Check Aerial satellite",
    accentClass: "border-go/30 bg-go-wash text-go",
  },
  "commercial-industrial": {
    imageSrc: "/placeholders/commercial-industrial.jpg",
    caption: "Commercial asset placeholder · Check Aerial or Street View",
    accentClass: "border-line-strong bg-ink text-paper",
  },
  "unclassified-parcel": {
    imageSrc: "/placeholders/unclassified-parcel.jpg",
    caption: "Parcel record placeholder · Check Aerial or Street View",
    accentClass: "border-line bg-card/90 text-ink-3",
  },
};

export interface PropertyPlaceholderContext {
  address?: string | null;
  title?: string | null;
  source?: string | null;
}

function classifyFromContext(context?: PropertyPlaceholderContext): {
  category: PropertyPlaceholderCategory;
  typeLabel: string;
} | null {
  if (!context) return null;
  const text = `${context.address || ""} ${context.title || ""}`.trim().toLowerCase();
  const source = String(context.source || "").trim().toLowerCase();

  if (/\b(duplex|triplex|quadplex|fourplex|multi[-\s]?family)\b/.test(text)) {
    return { category: "multi-family", typeLabel: "Multi-Family" };
  }
  if (/\b(manufactured|mobile\s+home|modular|trailer(?:\s+park)?|trlr)\b/.test(text)) {
    return { category: "manufactured-home", typeLabel: "Manufactured" };
  }
  if (/\b(condo(?:minium)?|town\s?ho(?:use|me)|co-?op|unit\s+[a-z0-9#-]+|apt\.?\s+[a-z0-9#-]+|pud)\b/.test(text)) {
    return { category: "condo-townhome", typeLabel: "Condo / Unit" };
  }
  if (/\b(commercial|warehouse|industrial|office\s+building|federal\s+(?:office|building)|courthouse|plaza|retail|suite\s+[a-z0-9#-]+)\b/.test(text)) {
    return { category: "commercial-industrial", typeLabel: "Commercial" };
  }
  if (!/\bparking\s+lot\b/.test(text) && /\b(vacant(?:\s+land|\s+lot)?|land\s+sale|unimproved\s+land|acreage|tract\s+\d+|lot\s+\d+[a-z]?|block\s+\d+\s+lot\s+\d+)\b/.test(text)) {
    return { category: "vacant-land", typeLabel: "Land / Lot" };
  }
  if (source === "hud") {
    return { category: "single-family", typeLabel: "HUD Single-Family" };
  }
  if (source === "usda") {
    return { category: "single-family", typeLabel: "USDA Single-Family" };
  }
  return null;
}

function classifyCategory(
  rawPropType: string | null | undefined,
  context?: PropertyPlaceholderContext,
): {
  category: PropertyPlaceholderCategory;
  typeLabel: string;
} {
  const normalized = String(rawPropType || "").trim();
  const lower = normalized.toLowerCase();

  if (!lower || lower === "unknown" || lower === "n/a" || lower === "other") {
    return classifyFromContext(context) || { category: "unclassified-parcel", typeLabel: "Unclassified Parcel" };
  }
  if (lower.includes("land") || lower.includes("lot") || lower.includes("acre") || lower.includes("farm") || lower.includes("vacant")) {
    return { category: "vacant-land", typeLabel: normalized };
  }
  if (lower.includes("manufactured") || lower.includes("mobile")) {
    return { category: "manufactured-home", typeLabel: normalized };
  }
  if (
    lower.includes("duplex") ||
    lower.includes("triplex") ||
    lower.includes("quad") ||
    lower.includes("multi") ||
    lower.includes("apartment")
  ) {
    return { category: "multi-family", typeLabel: normalized };
  }
  if (
    lower.includes("condo") ||
    lower.includes("town") ||
    lower.includes("pud") ||
    lower.includes("co-op") ||
    lower.includes("coop")
  ) {
    return { category: "condo-townhome", typeLabel: normalized };
  }
  if (
    lower.includes("commercial") ||
    lower.includes("office") ||
    lower.includes("warehouse") ||
    lower.includes("industrial") ||
    lower.includes("retail") ||
    lower.includes("lab") ||
    lower.includes("courthouse") ||
    lower.includes("parking") ||
    lower.includes("service") ||
    lower.includes("mixed")
  ) {
    return { category: "commercial-industrial", typeLabel: normalized };
  }
  if (lower.includes("single") || lower.includes("modular") || lower.includes("sfr") || lower.includes("house") || lower.includes("residential")) {
    return { category: "single-family", typeLabel: normalized };
  }

  return { category: "unclassified-parcel", typeLabel: normalized };
}

export function getPropertyPlaceholder(
  propType?: string | null,
  context?: PropertyPlaceholderContext,
): PropertyPlaceholderInfo {
  const { category, typeLabel } = classifyCategory(propType, context);
  const cfg = CATEGORY_CONFIG[category];
  return {
    category,
    typeLabel,
    imageSrc: cfg.imageSrc,
    alt: `Architectural illustration placeholder for property type: ${typeLabel} (not an observed photograph)`,
    caption: cfg.caption,
    accentClass: cfg.accentClass,
  };
}
