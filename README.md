# write-exif

![2023-05-17-15-24-00-43°30'30.2"N 16°26'29.0"E.jpg](./2023-05-17-15-24-00-43°30'30.2"N%2016°26'29.0"E.jpg)

## Usage

    ./write-exif [directory]

Updates the file creation/modified timestamps to match the given date.

Copies the metadata from file names onto their EXIF data, applies to
all `jpg` files in the specified directory. Defaults to the current directory.

File name format: 2023-05-09-19-51-00-52°22'42.2"N 4°52'59.9"E.jpg

```
YYYY-MM-DD-HH-MM-SS-DD°MM'SS.S"N DD°MM'SS.S"E.jpg # [date]-[time]-[geo coordinates].jpg
```

### Setup

I use [bun](https://github.com/oven-sh/bun) to run the script.
But you can transpile the TypeScript code using `tsc` and then run it
using `node`.
Alternatively `ts-node` can be used as well.
