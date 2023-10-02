#!/usr/bin/env bun

// SPDX-License-Identifier: MIT

import { readFileSync, readdirSync, utimesSync, writeFileSync } from "fs";
import * as piexif from "piexifjs";

const args = process.argv.slice(2);
let directory = ".";
if (args.length > 0) {
  directory = args[0];
}

if (args.some((arg) => arg === "-h" || arg === "--help")) {
  console.log("Usage: write-exif [directory] [--tz]");
  process.exit(0);
}

const localTz = args.some((arg) => arg.startsWith("--tz"));
let localOffset = -new Date().getTimezoneOffset() / 60;
if (localTz) {
  const tzArg = args.find((arg) => arg.startsWith("--tz="));
  if (tzArg) {
    localOffset = parseInt(tzArg.slice(5), 10);
  }
}

const files = readdirSync(directory, { withFileTypes: true }).filter(
  (f) => !f.isDirectory() && f.name.endsWith(".jpg"),
);

const filepath = (file: string) => `${directory}/${file}`;

// File name format: 2023-05-19-16-40-00-43°22'01.9"N 16°55'51.6"E.jpg
for (const file of files) {
  const metadata = {
    date: file.name.slice(0, 10),
    time: file.name.slice(11, 19).replace(/-/g, ":"),
  };
  const ts = new Date(`${metadata.date} ${metadata.time}`);
  if (localTz) {
    ts.setHours(ts.getHours() + localOffset);
    const minuteOffset = -ts.getTimezoneOffset() % 60;
    ts.setMinutes(ts.getMinutes() + minuteOffset);
  }

  const coordinates = file.name.slice(20, -4).split(" ");

  const jpeg = readFileSync(filepath(file.name));
  const data = jpeg.toString("binary");

  const exifObj = piexif.load(data);

  // Add timestamp data
  exifObj["Exif"][piexif.ExifIFD.DateTimeOriginal] = ts
    .toISOString()
    .replace(/T/, " ")
    .replace(/\..+/, "");

  // Extract lat, long and their respective hemisphere (N/S, E/W)
  const lat = dms2dec(coordinates[0].substring(0, coordinates[0].length - 1)); // latitude
  const long = dms2dec(coordinates[1].substring(0, coordinates[1].length - 1)); // longitude
  const latRef = coordinates[0].slice(-1) == "N" ? "N" : "S";
  const longRef = coordinates[1].slice(-1) == "E" ? "E" : "W";

  // Convert decimal to exif format (rationals)
  const latitude = dec2exif(lat);
  const longitude = dec2exif(long);

  // Add GPS data
  exifObj["GPS"][piexif.GPSIFD.GPSLatitudeRef] = latRef;
  exifObj["GPS"][piexif.GPSIFD.GPSLatitude] = latitude;
  exifObj["GPS"][piexif.GPSIFD.GPSLongitudeRef] = longRef;
  exifObj["GPS"][piexif.GPSIFD.GPSLongitude] = longitude;

  const exifbytes = piexif.dump(exifObj);
  const newData = piexif.insert(exifbytes, data);
  const newJpeg = Buffer.from(newData, "binary");

  writeFileSync(filepath(file.name), newJpeg);

  // Modify the created and updated timestamps
  // to match the timestamp of the photo
  utimesSync(filepath(file.name), ts, ts);
}

// DMS (Degrees Minutes Seconds) to Decimal Degrees
function dms2dec(dms: string) {
  const match = dms.match(/(\d+)°(\d+)'(\d+(\.\d+)?)"/)!;
  const degrees = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return degrees + minutes / 60 + seconds / 3600;
}

// Decimal Degrees to EXIF format (rationals)
function dec2exif(dec: number) {
  const absolute = Math.abs(dec);
  const degrees = Math.floor(absolute);
  const minutes = Math.floor((absolute - degrees) * 60);
  const seconds = ((absolute - degrees - minutes / 60) * 3600 * 10000).toFixed(
    0,
  ); // to 4 decimal places
  return [
    [degrees, 1],
    [minutes, 1],
    [seconds, 10000],
  ];
}
