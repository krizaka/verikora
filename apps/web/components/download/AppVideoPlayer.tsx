"use client";

import { Button } from "@krizaka/ui/button";
import { useState } from "react";

interface Props {
  poster: string;
  webm: string;
  mp4: string;
  /** Width and height of the recording: the box keeps its shape before and after the play (no layout shift). */
  width: number;
  height: number;
  play: string;
  label: string;
}

/** The poster first; the player is only created when asked (nothing is downloaded before), in a box of the same size. */
export function AppVideoPlayer({ poster, webm, mp4, width, height, play, label }: Readonly<Props>) {
  const [on, setOn] = useState(false);
  return (
    <div
      className="relative overflow-hidden rounded-lg border border-border-default bg-surface-sunken"
      style={{ aspectRatio: `${width} / ${height}`, maxWidth: height > width ? "17rem" : undefined }}
    >
      {on ? (
        <video
          className="absolute inset-0 size-full object-cover"
          controls
          autoPlay
          muted
          loop
          playsInline
          poster={poster}
          aria-label={label}
        >
          <source src={webm} type="video/webm" />
          <source src={mp4} type="video/mp4" />
        </video>
      ) : (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setOn(true)}
          className="group absolute inset-0 size-full cursor-pointer rounded-none p-0"
          aria-label={`${play}: ${label}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a CDN poster in a box of fixed shape */}
          <img
            src={poster}
            alt=""
            width={width}
            height={height}
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
          <span className="absolute inset-0 grid place-items-center">
            <span className="rounded-md bg-surface-raised/90 px-4 py-2 text-sm font-medium text-fg-primary shadow group-hover:bg-surface-raised">
              {play}
            </span>
          </span>
        </Button>
      )}
    </div>
  );
}
