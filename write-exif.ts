#!/usr/bin/env bun

// SPDX-License-Identifier: MIT

import {
  existsSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "fs";
import piexif from "piexifjs";

type Location = { lat: number; lon: number };

type Metadata = {
  make?: string;
  model?: string;
  lens?: { make?: string; model?: string };
  film?: string;
  iso?: number;
  flash?: boolean;
  location?: string | [number, number];
};

type Roll = Metadata & {
  start?: Temporal.PlainDateTime;
  end?: Temporal.PlainDateTime;
  reverse?: boolean;
  tz?: string;
  frames?: Record<string, Metadata>;
};

type Frame = {
  file: string;
  time?: Temporal.PlainDateTime;
  location?: Location;
  metadata?: Metadata;
};

type Tag = [ifd: "0th" | "Exif" | "GPS", tag: number, value: unknown];

const args = process.argv.slice(2);

if (args.some((arg) => arg === "-h" || arg === "--help")) {
  console.log("Usage: write-exif [directory] [--tz=<zone>]");
  process.exit(0);
}

const directory = args.find((arg) => !arg.startsWith("-")) ?? ".";
const filepath = (file: string) => `${directory}/${file}`;

const roll: Roll | undefined = existsSync(filepath("roll.toml"))
  ? (Bun.TOML.parse(readFileSync(filepath("roll.toml"), "utf8")) as Roll)
  : undefined;

const tz =
  roll?.tz ??
  args.find((arg) => arg.startsWith("--tz="))?.slice(5) ??
  Temporal.Now.timeZoneId();

const frames = plan(
  readdirSync(directory, { withFileTypes: true })
    .filter((f) => !f.isDirectory() && f.name.endsWith(".jpg"))
    .map((f) => f.name)
    .sort(),
  roll,
);

for (const frame of frames) {
  write(frame);
}

function plan(files: string[], roll?: Roll): Frame[] {
  const named = files.map((file) => ({ file, ...parseName(file) }));
  if (!roll) {
    return named;
  }

  const { start, end, reverse, tz, frames = {}, ...base } = roll;
  const ordered =
    reverse && !named.every((frame) => frame.time) ? named.reverse() : named;

  const unknown = Object.keys(frames).filter(
    (index) =>
      !(Number.isInteger(+index) && +index >= 1 && +index <= ordered.length),
  );
  if (unknown.length > 0) {
    throw new Error(
      `roll.toml has frames ${unknown.join(", ")} but the roll has ${ordered.length} frames`,
    );
  }

  const times = spread(start, end, ordered.length);

  return ordered.map((frame, i) => {
    const override = frames[i + 1] ?? {};
    const metadata = {
      ...base,
      ...override,
      lens: { ...base.lens, ...override.lens },
    };
    return {
      file: frame.file,
      time: times?.[i] ?? frame.time,
      location: metadata.location
        ? parseLocation(metadata.location)
        : frame.location,
      metadata,
    };
  });
}

function spread(
  start: Temporal.PlainDateTime | undefined,
  end: Temporal.PlainDateTime | undefined,
  count: number,
) {
  if (!start && !end) {
    return undefined;
  }
  if (!start || !end) {
    throw new Error("roll.toml needs both start and end");
  }
  const seconds = start.until(end, { largestUnit: "seconds" }).seconds;
  if (seconds < 0) {
    throw new Error("roll.toml end is before start");
  }
  const step = count > 1 ? seconds / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) =>
    start.add({ seconds: Math.round(i * step) }),
  );
}

function write(frame: Frame) {
  const missing = [!frame.time && "time", !frame.location && "location"].filter(
    Boolean,
  );
  if (missing.length > 0) {
    console.warn(`${frame.file}: no ${missing.join(" or ")} to write`);
  }

  const data = readFileSync(filepath(frame.file)).toString("binary");
  const exif = piexif.load(data);

  for (const [ifd, tag, value] of tags(frame)) {
    if (value !== undefined) {
      exif[ifd] = { ...exif[ifd], [tag]: value };
    }
  }

  writeFileSync(
    filepath(frame.file),
    Buffer.from(piexif.insert(piexif.dump(exif), data), "binary"),
  );

  if (frame.time) {
    const instant = new Date(frame.time.toZonedDateTime(tz).epochMilliseconds);
    utimesSync(filepath(frame.file), instant, instant);
  }
}

function tags({ time, location, metadata }: Frame): Tag[] {
  const [date, clock] = time
    ? time.toString({ smallestUnit: "second" }).split("T")
    : [];
  const position: Tag[] = location
    ? [
        ["GPS", piexif.GPSIFD.GPSLatitudeRef, location.lat < 0 ? "S" : "N"],
        ["GPS", piexif.GPSIFD.GPSLatitude, rational(location.lat)],
        ["GPS", piexif.GPSIFD.GPSLongitudeRef, location.lon < 0 ? "W" : "E"],
        ["GPS", piexif.GPSIFD.GPSLongitude, rational(location.lon)],
      ]
    : [];
  const roll: Tag[] = metadata
    ? [
        ["0th", piexif.ImageIFD.Make, metadata.make],
        ["0th", piexif.ImageIFD.Model, metadata.model],
        ["0th", piexif.ImageIFD.ImageDescription, metadata.film],
        ["Exif", piexif.ExifIFD.LensMake, metadata.lens?.make],
        ["Exif", piexif.ExifIFD.LensModel, metadata.lens?.model],
        ["Exif", piexif.ExifIFD.ISOSpeedRatings, metadata.iso],
        [
          "Exif",
          piexif.ExifIFD.Flash,
          metadata.flash === undefined ? undefined : Number(metadata.flash),
        ],
        ["Exif", piexif.ExifIFD.FileSource, "\x01"],
      ]
    : [];
  return [
    [
      "Exif",
      piexif.ExifIFD.DateTimeOriginal,
      date && `${date.replaceAll("-", ":")} ${clock}`,
    ],
    ...position,
    ...roll,
  ];
}

function parseName(file: string): Omit<Frame, "file"> {
  const match = file.match(
    /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})-(.+)\.jpg$/,
  );
  if (!match) {
    return {};
  }
  const [, date, hour, minute, second, location] = match;
  return {
    time: Temporal.PlainDateTime.from(`${date}T${hour}:${minute}:${second}`),
    location: matchDms(location),
  };
}

function parseLocation(location: string | [number, number]): Location {
  if (Array.isArray(location)) {
    const [lat, lon] = location;
    return { lat, lon };
  }
  const parsed = matchDms(location);
  if (!parsed) {
    throw new Error(`Invalid location: ${location}`);
  }
  return parsed;
}

function matchDms(location: string): Location | undefined {
  const match = location.match(
    /^(\d+)°(\d+)'(\d+(?:\.\d+)?)"([NS]) (\d+)°(\d+)'(\d+(?:\.\d+)?)"([EW])$/,
  );
  if (!match) {
    return undefined;
  }
  const [, latD, latM, latS, latRef, lonD, lonM, lonS, lonRef] = match;
  const dec = (d: string, m: string, s: string) => +d + +m / 60 + +s / 3600;
  return {
    lat: dec(latD, latM, latS) * (latRef === "N" ? 1 : -1),
    lon: dec(lonD, lonM, lonS) * (lonRef === "E" ? 1 : -1),
  };
}

function rational(dec: number) {
  const units = Math.round(Math.abs(dec) * 36000000);
  return [
    [Math.floor(units / 36000000), 1],
    [Math.floor((units % 36000000) / 600000), 1],
    [units % 600000, 10000],
  ];
}
