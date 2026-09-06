type PropertyEvidenceVisualProps = {
  listingId?: string | null;
  address: string;
  compact?: boolean;
  className?: string;
  statusLabel?: string;
};

const palettes = [
  { ink: "#0f172a", field: "#f1f5f9", parcel: "#e2e8f0", accent: "#fbbf24", line: "#475569" },
  { ink: "#14283a", field: "#dce8ec", parcel: "#bad6d9", accent: "#fbbf24", line: "#3c6172" },
  { ink: "#0f172a", field: "#f8fafc", parcel: "#e2e8f0", accent: "#f59e0b", line: "#64748b" },
  { ink: "#172b3d", field: "#f1f5f9", parcel: "#cbd5e1", accent: "#f2b35c", line: "#475569" },
] as const;

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function take(seed: number, offset: number, range: number) {
  return (((seed >>> offset) ^ Math.imul(seed, offset + 17)) >>> 0) % range;
}

function addressLines(address: string) {
  const clean = address.replace(/\s+/g, " ").trim() || "Address under review";
  if (clean.length <= 39) return [clean];

  const splitCandidates = [clean.lastIndexOf(",", 39), clean.lastIndexOf(" ", 39)];
  const splitAt = Math.max(...splitCandidates);
  if (splitAt < 16) return [`${clean.slice(0, 36).trim()}…`, clean.slice(36, 72).trim()];
  const secondLine = clean.slice(splitAt + 1).trim();
  return [clean.slice(0, splitAt).trim(), secondLine.length > 39 ? `${secondLine.slice(0, 36).trim()}…` : secondLine];
}

/**
 * A deterministic evidence diagram used only when no verified property photo is
 * available. Its schematic language and permanent in-art disclosure prevent it
 * from being read as a depiction of the subject property.
 */
export function PropertyEvidenceVisual({ listingId, address, compact = false, className = "", statusLabel }: PropertyEvidenceVisualProps) {
  const seed = stableHash(`${listingId || "unresolved"}|${address.toLowerCase()}`);
  const palette = palettes[seed % palettes.length];
  const lines = addressLines(address);
  const parcelPoints = [
    [198 + take(seed, 1, 54), 158 + take(seed, 3, 38)],
    [820 + take(seed, 5, 80), 116 + take(seed, 7, 46)],
    [1000 - take(seed, 9, 54), 402 + take(seed, 11, 42)],
    [708 - take(seed, 13, 48), 542 + take(seed, 15, 24)],
    [176 + take(seed, 17, 58), 466 - take(seed, 19, 34)],
  ];
  const buildingX = 416 + take(seed, 6, 82);
  const buildingY = 238 + take(seed, 10, 48);
  const buildingWidth = 222 + take(seed, 14, 76);
  const buildingHeight = 132 + take(seed, 18, 50);
  const wing = 54 + take(seed, 21, 48);
  const buildingPoints = [
    [buildingX, buildingY],
    [buildingX + buildingWidth, buildingY],
    [buildingX + buildingWidth, buildingY + buildingHeight - wing],
    [buildingX + buildingWidth - wing, buildingY + buildingHeight - wing],
    [buildingX + buildingWidth - wing, buildingY + buildingHeight],
    [buildingX, buildingY + buildingHeight],
  ];
  const evidenceNodes = Array.from({ length: 7 }, (_, index) => ({
    x: 178 + take(seed, (index * 3 + 2) % 23, 810),
    y: 126 + take(seed, (index * 5 + 4) % 23, 372),
    radius: index % 3 === 0 ? 8 : 5,
  }));
  const recordSuffix = (listingId || seed.toString(16).toUpperCase()).replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase() || "PENDING";
  const parcelPolygon = parcelPoints.map(([x, y]) => `${x},${y}`).join(" ");
  const buildingPolygon = buildingPoints.map(([x, y]) => `${x},${y}`).join(" ");

  return (
    <div
      role="img"
      aria-label={`Research visualization for ${address}. This is not a property photo. A verified photo is pending.`}
      data-testid="property-evidence-visual"
      className={`relative isolate h-full w-full overflow-hidden ${className}`}
      style={{ backgroundColor: palette.ink }}
    >
      <svg aria-hidden="true" viewBox="0 0 1200 720" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
        <rect width="1200" height="720" fill={palette.ink} />
        <circle cx={1030} cy={110} r={255} fill={palette.field} opacity="0.08" />
        <circle cx={120} cy={670} r={310} fill={palette.accent} opacity="0.07" />

        <g stroke={palette.field} strokeWidth="1" opacity="0.1">
          {Array.from({ length: 16 }, (_, index) => <line key={`v-${index}`} x1={index * 80} y1="0" x2={index * 80} y2="720" />)}
          {Array.from({ length: 10 }, (_, index) => <line key={`h-${index}`} x1="0" y1={index * 80} x2="1200" y2={index * 80} />)}
        </g>

        <g fill="none" stroke={palette.line} strokeWidth="2" opacity="0.56">
          <path d={`M -30 ${232 + take(seed, 2, 30)} C 190 124, 342 332, 574 206 S 930 100, 1230 208`} />
          <path d={`M -50 ${322 + take(seed, 7, 30)} C 180 214, 352 422, 602 302 S 958 202, 1250 298`} />
          <path d={`M -80 ${422 + take(seed, 12, 30)} C 170 302, 366 510, 642 394 S 1002 292, 1270 390`} />
        </g>

        <path d="M -90 566 L 1250 410 L 1270 498 L -70 654 Z" fill="#f5f1e7" opacity="0.16" />
        <path d="M -90 601 L 1250 445" fill="none" stroke={palette.field} strokeDasharray="20 18" strokeWidth="4" opacity="0.42" />

        <polygon points={parcelPolygon} fill={palette.parcel} fillOpacity="0.16" stroke={palette.accent} strokeWidth="5" strokeLinejoin="round" />
        <polygon points={buildingPolygon} fill={palette.field} fillOpacity="0.22" stroke={palette.field} strokeWidth="4" strokeLinejoin="round" />
        <path d={`M ${buildingX + 22} ${buildingY + 28} H ${buildingX + buildingWidth - 28} M ${buildingX + 22} ${buildingY + 62} H ${buildingX + buildingWidth - wing - 18}`} stroke={palette.field} strokeWidth="3" opacity="0.6" />

        <g stroke={palette.accent} strokeWidth="2" opacity="0.7">
          {evidenceNodes.slice(1).map((node, index) => (
            <line key={`link-${index}`} x1={evidenceNodes[0].x} y1={evidenceNodes[0].y} x2={node.x} y2={node.y} strokeDasharray="5 9" />
          ))}
        </g>
        <g>
          {evidenceNodes.map((node, index) => (
            <g key={`node-${index}`}>
              <circle cx={node.x} cy={node.y} r={node.radius + 6} fill={palette.ink} stroke={palette.accent} strokeWidth="1" opacity="0.9" />
              <circle cx={node.x} cy={node.y} r={node.radius} fill={index === 0 ? palette.accent : palette.field} />
            </g>
          ))}
        </g>

        <g transform="translate(1080 148)" fill="none" stroke={palette.field} opacity="0.8">
          <circle r="35" strokeWidth="2" />
          <path d="M 0 -25 L 8 8 L 0 3 L -8 8 Z" fill={palette.accent} stroke="none" />
          <path d="M 0 3 V 25" strokeWidth="2" />
          <text x="0" y="-46" textAnchor="middle" fill={palette.field} stroke="none" fontSize="18" fontWeight="700">N</text>
        </g>

        <g transform="translate(64 56)">
          <rect width="324" height="42" rx="8" fill={palette.accent} />
          <text x="20" y="27" fill={palette.ink} fontSize="17" fontWeight="800" letterSpacing="2.5">RESEARCH VISUALIZATION</text>
        </g>
        <text x="1136" y="80" textAnchor="end" fill={palette.field} fontSize="17" fontWeight="700" letterSpacing="2">NOT A PROPERTY PHOTO</text>
        <text x="1136" y="109" textAnchor="end" fill={palette.field} opacity="0.7" fontSize="14" fontWeight="600" letterSpacing="1.5">RECORD {recordSuffix}</text>

        <g transform="translate(0 540)">
          <rect width="1200" height="180" fill={palette.ink} opacity="0.94" />
          <line x1="64" y1="0" x2="1136" y2="0" stroke={palette.field} strokeWidth="2" opacity="0.22" />
          <circle cx="82" cy="42" r="7" fill={palette.accent} />
          <text x="104" y="48" fill={palette.accent} fontSize="18" fontWeight="800" letterSpacing="2">VERIFIED PHOTO PENDING</text>
          <text x="1136" y="48" textAnchor="end" fill={palette.field} opacity="0.76" fontSize="14" fontWeight="700" letterSpacing="1.5">EVIDENCE CANVAS / {statusLabel?.toUpperCase() || "SOURCE MEDIA OPEN"}</text>
          <text x="64" y={lines.length > 1 ? 90 : 104} fill="#ffffff" fontSize={compact ? "25" : "29"} fontWeight="750" letterSpacing="-0.4">
            {lines.map((line, index) => <tspan key={line} x="64" dy={index === 0 ? 0 : 34}>{line}</tspan>)}
          </text>
          {!compact ? <text x="1136" y="112" textAnchor="end" fill={palette.field} opacity="0.74" fontSize="14" fontWeight="600">Parcel geometry is illustrative · confirm against cited records</text> : null}
        </g>
      </svg>
    </div>
  );
}
