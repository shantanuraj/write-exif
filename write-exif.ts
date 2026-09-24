#!/usr/bin/env bun

// SPDX-License-Identifier: MIT

import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  utimesSync,
  writeFileSync,
} from "fs";
import tzLookup from "@photostructure/tz-lookup";
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
  frames?: Record<string, Metadata & { time?: Temporal.PlainDateTime }>;
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
  console.log("Usage: write-exif [directory] [--rename] [--dry]");
  process.exit(0);
}

const directory = args.find((arg) => !arg.startsWith("-")) ?? ".";
const filepath = (file: string) => `${directory}/${file}`;

const roll: Roll | undefined = existsSync(filepath("roll.toml"))
  ? (Bun.TOML.parse(readFileSync(filepath("roll.toml"), "utf8")) as Roll)
  : undefined;

const frames = plan(
  readdirSync(directory, { withFileTypes: true })
    .filter((f) => !f.isDirectory() && f.name.endsWith(".jpg"))
    .map((f) => f.name)
    .sort(),
  roll,
);

const targets = args.includes("--rename") ? frames.map(name) : undefined;
if (targets && new Set(targets).size !== targets.length) {
  throw new Error("Rename would give several frames the same name");
}

if (args.includes("--dry")) {
  preview(frames, targets);
  process.exit(0);
}

for (const frame of frames) {
  write(frame);
}

if (targets) {
  const moves = frames
    .map((frame, i) => [frame.file, targets[i]])
    .filter(([from, to]) => from !== to);
  for (const [from] of moves) {
    renameSync(filepath(from), filepath(`${from}.rename`));
  }
  for (const [from, to] of moves) {
    renameSync(filepath(`${from}.rename`), filepath(to));
    console.log(`${from} -> ${to}`);
  }
}

function plan(files: string[], roll?: Roll): Frame[] {
  const named = files.map((file) => ({ file, ...parseName(file) }));
  if (!roll) {
    return named;
  }

  const { start, end, reverse, frames = {}, ...base } = roll;
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

  const times = spread(ordered.length, [
    [0, start],
    [ordered.length - 1, end],
    ...Object.entries(frames).map(
      ([index, frame]) => [+index - 1, frame.time] as const,
    ),
  ]);

  return ordered.map((frame, i) => {
    const { time, ...override } = frames[i + 1] ?? {};
    const metadata = {
      ...base,
      ...override,
      lens: { ...base.lens, ...override.lens },
    };
    return {
      file: frame.file,
      time: times[i] ?? frame.time,
      location: metadata.location
        ? parseLocation(metadata.location)
        : frame.location,
      metadata,
    };
  });
}

function spread(
  count: number,
  pins: (readonly [number, Temporal.PlainDateTime | undefined])[],
) {
  const anchors = [
    ...new Map(
      pins.filter((pin): pin is [number, Temporal.PlainDateTime] => !!pin[1]),
    ),
  ].sort(([a], [b]) => a - b);

  anchors.forEach(([index, time], k) => {
    if (k > 0 && Temporal.PlainDateTime.compare(anchors[k - 1][1], time) > 0) {
      throw new Error(`roll.toml time goes backwards at frame ${index + 1}`);
    }
  });

  return Array.from({ length: count }, (_, i) => {
    const right = anchors.findIndex(([index]) => index >= i);
    if (right === -1) {
      return undefined;
    }
    const [to, later] = anchors[right];
    if (to === i) {
      return later;
    }
    if (right === 0) {
      return undefined;
    }
    const [from, earlier] = anchors[right - 1];
    const seconds = earlier.until(later, { largestUnit: "seconds" }).seconds;
    return earlier.add({
      seconds: Math.round((seconds * (i - from)) / (to - from)),
    });
  });
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
    const instant = new Date(
      frame.time.toZonedDateTime(zone(frame)).epochMilliseconds,
    );
    utimesSync(filepath(frame.file), instant, instant);
  }
}

function zone({ location }: Frame) {
  return location
    ? tzLookup(location.lat, location.lon)
    : Temporal.Now.timeZoneId();
}

function preview(frames: Frame[], targets?: string[]) {
  const join = (...parts: unknown[]) => parts.filter(Boolean).join(" ");
  const rows: Record<string, string>[] = frames.map((frame, i) => ({
    file: frame.file,
    time:
      frame.time?.toString({ smallestUnit: "second" }).replace("T", " ") ?? "",
    zone: frame.time ? zone(frame) : "",
    location: frame.location ? position(frame.location) : "",
    camera: join(frame.metadata?.make, frame.metadata?.model),
    lens: join(frame.metadata?.lens?.make, frame.metadata?.lens?.model),
    film: join(frame.metadata?.film),
    iso: join(frame.metadata?.iso),
    flash:
      frame.metadata?.flash === undefined
        ? ""
        : frame.metadata.flash
          ? "yes"
          : "no",
    ...(targets && { rename: targets[i] }),
  }));
  const shared = Object.keys(rows[0] ?? {}).filter(
    (key) =>
      key !== "file" &&
      key !== "time" &&
      rows.every((row) => row[key] === rows[0][key]),
  );
  for (const key of shared) {
    if (rows[0][key]) {
      console.log(`${key}: ${rows[0][key]}`);
    }
  }
  console.table(
    Object.fromEntries(
      rows.map((row, i) => [
        i + 1,
        Object.fromEntries(
          Object.entries(row).filter(([key]) => !shared.includes(key)),
        ),
      ]),
    ),
  );
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

function name({ file, time, location }: Frame) {
  if (!time || !location) {
    throw new Error(`${file}: rename needs both time and location`);
  }
  const [date, clock] = time.toString({ smallestUnit: "second" }).split("T");
  return `${date}-${clock.replaceAll(":", "-")}-${position(location)}.jpg`;
}

function position({ lat, lon }: Location) {
  return `${dms(lat, "N", "S")} ${dms(lon, "E", "W")}`;
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

function dms(dec: number, positive: string, negative: string) {
  const tenths = Math.round(Math.abs(dec) * 36000);
  const degrees = Math.floor(tenths / 36000);
  const minutes = String(Math.floor((tenths % 36000) / 600)).padStart(2, "0");
  const seconds = ((tenths % 600) / 10).toFixed(1).padStart(4, "0");
  return `${degrees}°${minutes}'${seconds}"${dec < 0 ? negative : positive}`;
}

function rational(dec: number) {
  const units = Math.round(Math.abs(dec) * 36000000);
  return [
    [Math.floor(units / 36000000), 1],
    [Math.floor((units % 36000000) / 600000), 1],
    [units % 600000, 10000],
  ];
}
