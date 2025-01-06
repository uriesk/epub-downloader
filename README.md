# epub Downloader

Downloads websites as epub by using mozillas [Readability.js](https://github.com/mozilla/readability) and [html-to-epub](https://github.com/lesjoursfr/html-to-epub).
A reference to the source is added as second chapter.
It can save epubs with automatic generated YYYY-MM-DD-title.epub filenames and optionally drop them into subfolders by website name.

## Installation

nodejs with npm needs to be installed

```
git clone https://github.com/uriesk/epub-downloader.git
cd epub-downloader
npm install
```

## Usage

Inside the epub-downloader folder do

```
node index.js --help
```

```
Usage: node ./index.js [-o output_filename] [-p path] [-s] [url-to-article]

-o, --output    Filepath for the epub
-p, --path      Path for the epub, filename will be automatically generated, only effective if -o not given
-s, --create_subfolders Create subfolders by sitename, only effective if -o not given
-c, --cover     URL to a cover image
```

to see the available options

### Example

```
node index.js https://0pointer.net/blog/linux-boot-partitions.html
```

Will store the article as `2025-01-06_linux-boot-partitions.epub` file into the current directory.

```
node index.js -s https://0pointer.net/blog/linux-boot-partitions.html
```

Will store the article under the subfolder `./0pointer.net/2025-01-06_linux-boot-partitions.epub` within the current directory. Directory can be changed with the `-p` option.

## Why is this not published on npm?

It is only one simple script. In case of broader interest it will be published.
