# write-exif

![2023-05-17-15-24-00-43°30'30.2"N 16°26'29.0"E.jpg](./2023-05-17-15-24-00-43°30'30.2"N%2016°26'29.0"E.jpg)

## Usage

    ./write-exif [directory] [--tz=<hours>]

Updates the file creation/modified timestamps to match the given date.
The file name time is local wall-clock time; `--tz=<hours>` sets the UTC
offset it was taken in (e.g. `--tz=2`), defaulting to the machine's timezone.

Copies the metadata from file names onto their EXIF data, applies to
all `jpg` files in the specified directory. Defaults to the current directory.

File name format: 2023-05-09-19-51-00-52°22'42.2"N 4°52'59.9"E.jpg

```
YYYY-MM-DD-HH-MM-SS-DD°MM'SS.S"N DD°MM'SS.S"E.jpg # [date]-[time]-[geo coordinates].jpg
```

### Roll metadata

For film scans, put a `roll.toml` in the directory to apply per-roll
metadata to every frame. All fields are optional.
See [`roll.example.toml`](./roll.example.toml).

| Field        | EXIF tag           |
| ------------ | ------------------ |
| `make`       | `Make`             |
| `model`      | `Model`            |
| `film`       | `ImageDescription` |
| `iso`        | `ISOSpeedRatings`  |
| `flash`      | `Flash`            |
| `lens.make`  | `LensMake`         |
| `lens.model` | `LensModel`        |

When `roll.toml` is present, `FileSource` is set to film scanner.

### Setup

I use [bun](https://github.com/oven-sh/bun) to run the script.
But you can transpile the TypeScript code using `tsc` and then run it
using `node`.
Alternatively `ts-node` can be used as well.
