'use client';
// acknowledged-orphan: Task 11 vector blueprint image fallback component used for decision packets and responsive card visuals.

import { useState } from 'react';
import Image from 'next/image';

interface PropertyImageProps {
  src?: string | null;
  alt: string;
  address?: string;
  state?: string;
  county?: string;
  propType?: string;
  openingBid?: number | null;
  className?: string;
  aspectRatio?: '4/3' | '16/9' | 'square';
  priority?: boolean;
}

export function PropertyImage({
  src,
  alt,
  address = 'Distressed Property',
  state = 'US',
  county = 'County',
  propType = 'Residential',
  openingBid = null,
  className = '',
  aspectRatio = '4/3',
  priority = false
}: PropertyImageProps) {
  const [imageError, setImageError] = useState(false);

  const ratioClass =
    aspectRatio === '16/9'
      ? 'aspect-video'
      : aspectRatio === 'square'
      ? 'aspect-square'
      : 'aspect-[4/3]';

  const bidFormatted =
    openingBid && Number.isFinite(openingBid) && openingBid > 0
      ? `$${openingBid.toLocaleString()}`
      : 'Auction Scheduled';

  // Fallback to Blueprint Vector UI if no valid source or image fails to load
  if (!src || imageError) {
    return (
      <div
        className={`relative w-full ${ratioClass} bg-[#0b1120] rounded-xl overflow-hidden border border-slate-800 flex flex-col justify-between p-4 select-none ${className}`}
        role="img"
        aria-label={`Cadastral blueprint for ${address}`}
      >
        {/* Blueprint background grid */}
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(#38bdf8 1px, transparent 1px), linear-gradient(90deg, #38bdf8 1px, transparent 1px)',
            backgroundSize: '24px 24px'
          }}
        />

        {/* Top Badges */}
        <div className="relative z-10 flex items-center justify-between gap-2">
          <span className="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-sky-950/80 text-sky-400 border border-sky-800/80">
            {state} · {county}
          </span>
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800/90 text-slate-300 border border-slate-700">
            {propType}
          </span>
        </div>

        {/* Isometric Parcel Vector Outline Graphic */}
        <div className="relative z-10 my-auto flex items-center justify-center">
          <svg
            className="w-20 h-20 text-sky-500/60 drop-shadow-md"
            viewBox="0 0 100 100"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polygon points="50,15 85,35 85,75 50,95 15,75 15,35" strokeDasharray="4 2" />
            <polygon points="50,35 70,48 70,72 50,84 30,72 30,48" fill="currentColor" fillOpacity="0.2" strokeWidth="2.5" />
          </svg>
        </div>

        {/* Bottom Metadata */}
        <div className="relative z-10 bg-slate-900/90 backdrop-blur-sm p-2.5 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
          <div className="truncate pr-2">
            <p className="font-bold text-slate-200 truncate">{address}</p>
            <p className="text-[10px] text-slate-400">Opening Bid: <span className="text-sky-400 font-semibold">{bidFormatted}</span></p>
          </div>
          <span className="text-[9px] uppercase tracking-wider text-slate-500 shrink-0 font-bold">
            Blueprint
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full ${ratioClass} overflow-hidden rounded-xl bg-slate-900 ${className}`}>
      <img
        src={src}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        className="w-full h-full object-cover transition duration-300 hover:scale-105"
        onError={() => setImageError(true)}
      />
    </div>
  );
}

export default PropertyImage;
