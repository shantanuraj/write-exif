# write-exif

![2023-05-17-15-24-00-43°30'30.2"N 16°26'29.0"E.jpg](./2023-05-17-15-24-00-43°30'30.2"N%2016°26'29.0"E.jpg)

## Usage

    ./write-exif [directory] [--tz=<zone>] [--rename]

Writes metadata onto the EXIF data of all `jpg` files in the directory,
which defaults to the current directory, and sets each file's
creation/modified timestamps to when the photo was taken.

Time and location come from the file name, or from `roll.toml` when present.

File name format: 2023-05-09-19-51-00-52°22'42.2"N 4°52'59.9"E.jpg

```
YYYY-MM-DD-HH-MM-SS-DD°MM'SS.S"N DD°MM'SS.S"E.jpg # [date]-[time]-[geo coordinates].jpg
```

Times are local wall-clock times. `--tz=<zone>` sets the time zone they
were taken in, e.g. `--tz=Europe/Amsterdam` or `--tz=+02:00`, defaulting
to the machine's time zone.

`--rename` renames every file to the format above.

### Roll metadata

For film scans, put a `roll.toml` in the directory to describe the roll.
All fields are optional. See [`roll.example.toml`](./roll.example.toml).

| Field        | EXIF tag           |
| ------------ | ------------------ |
| `make`       | `Make`             |
| `model`      | `Model`            |
| `film`       | `ImageDescription` |
| `iso`        | `ISOSpeedRatings`  |
| `flash`      | `Flash`            |
| `lens.make`  | `LensMake`         |
| `lens.model` | `LensModel`        |
| `location`   | `GPS*`             |

When `roll.toml` is present, `FileSource` is set to film scanner.

`location` is either `"DD°MM'SS.S\"N DD°MM'SS.S\"E"` or `[latitude, longitude]`.

`start` and `end` spread the frames evenly across that time range, in
shooting order. Frames are in file name order; `reverse = true` flips it
for scanners that number frames backwards. Files already named by time
are always in time order.

`tz` is the time zone the roll was shot in, and takes precedence over `--tz`.

`roll.toml` takes precedence over the file name. Values under
`[frames.<n>]` override the roll for the n-th frame in shooting order,
counting from 1.

### Setup

I use [bun](https://github.com/oven-sh/bun) to run the script.
But you can transpile the TypeScript code using `tsc` and then run it
using `node`.
Alternatively `ts-node` can be used as well.
