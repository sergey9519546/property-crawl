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

function classifyCategory(rawPropType: string | null | undefined): {
  category: PropertyPlaceholderCategory;
  typeLabel: string;
} {
  const normalized = String(rawPropType || "").trim();
  const lower = normalized.toLowerCase();

  if (!lower || lower === "unknown" || lower === "n/a" || lower === "other") {
    return { category: "unclassified-parcel", typeLabel: "Unclassified Parcel" };
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

export function getPropertyPlaceholder(propType?: string | null): PropertyPlaceholderInfo {
  const { category, typeLabel } = classifyCategory(propType);
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
