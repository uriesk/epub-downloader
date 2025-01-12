/*
 * taken from https://github.com/uriesk/html-to-epub/tree/main
 * and heavily modified
 *
 * License: MIT
 *
 */

import archiver from "archiver";
import { renderFile } from "ejs";
import { encodeXML } from "entities";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  copyFileSync,
  renameSync,
  rmSync,
} from "fs";
import { imageSize } from "image-size";
import mime from "mime";
import path from "path";
import rehypeParse from "rehype-parse";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { promisify } from "util";
import { fileURLToPath } from "url";

import {
  uuid,
  slug,
  defaultAllowedAttributes,
  defaultAllowedXhtml11Tags,
  downloadFile,
} from './utils.js';

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export class EPub {
  uuid;
  title;
  description;
  cover;
  firstImageIsCover;
  coverMediaType;
  coverExtension;
  coverDimensions = {
    width: 0,
    height: 0,
  };
  publisher;
  author;
  tocTitle;
  appendChapterTitles;
  showToC;
  date;
  lang;
  css;
  fonts;
  content;
  images;
  audioVideo;
  customOpfTemplatePath;
  customNcxTocTemplatePath;
  customHtmlCoverTemplatePath;
  customHtmlTocTemplatePath;
  version;
  userAgent;
  verbose;
  tempDir;
  tempEpubDir;
  output;
  allowedAttributes;
  allowedXhtml11Tags;

  constructor(options, output) {
    // File ID
    this.uuid = uuid();
    // Required options
    this.title = options.title;
    this.description = options.description;
    this.output = output;
    // Options with defaults
    this.cover = options.cover ?? null;
    this.firstImageIsCover = (options.firstImageIsCover && !this.cover) ?? false;
    this.publisher = options.publisher ?? "anonymous";
    this.author = options.author
      ? typeof options.author === "string"
        ? [options.author]
        : options.author
      : ["anonymous"];
    if (this.author.length === 0) {
      this.author = ["anonymous"];
    }
    this.tocTitle = options.tocTitle ?? "Table Of Contents";
    this.appendChapterTitles = options.appendChapterTitles ?? true;
    this.showToC = options.hideToC !== true;
    this.date = options.date ?? new Date().toISOString();
    this.lang = options.lang ?? "en";
    this.css = options.css ?? null;
    this.fonts = options.fonts ?? [];
    this.customOpfTemplatePath = options.customOpfTemplatePath ?? null;
    this.customNcxTocTemplatePath = options.customNcxTocTemplatePath ?? null;
    this.customHtmlTocTemplatePath = options.customHtmlTocTemplatePath ?? null;
    this.customHtmlCoverTemplatePath = options.customHtmlCoverTemplatePath ?? null;
    this.version = options.version ?? 3;
    this.userAgent =
      options.userAgent ??
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.105 Safari/537.36";
    this.verbose = options.verbose ?? false;
    this.allowedAttributes = options.allowedAttributes ?? defaultAllowedAttributes;
    this.allowedXhtml11Tags = options.allowedXhtml11Tags ?? defaultAllowedXhtml11Tags;
    // Temporary folder for work
    this.tempDir = options.tempDir ?? path.resolve(__dirname, "../tempDir/");
    this.tempEpubDir = path.resolve(this.tempDir, this.uuid);
    // Check the cover image
    if (this.cover !== null) {
      this.coverMediaType = mime.getType(this.cover);
      if (this.coverMediaType === null) {
        throw new Error(`The cover image can't be processed : ${this.cover}`);
      }
      this.coverExtension = mime.getExtension(this.coverMediaType);
      if (this.coverExtension === null) {
        throw new Error(`The cover image can't be processed : ${this.cover}`);
      }
    }
    else {
      this.coverMediaType = null;
      this.coverExtension = null;
    }
    const loadHtml = (content, plugins) => unified()
      .use(rehypeParse, { fragment: true })
      .use(plugins)
      // Voids: [] is required for epub generation, and causes little/no harm for non-epub usage
      .use(rehypeStringify, { allowDangerousHtml: true, voids: [], collapseBooleanAttributes: false })
      .processSync(content)
      .toString();
    this.images = [];
    this.audioVideo = [];
    this.content = [];
    // Insert cover in content
    if (this.cover) {
      const templatePath = this.customHtmlCoverTemplatePath || path.resolve(__dirname, `../templates/epub${this.version}/cover.xhtml.ejs`);
      if (!existsSync(templatePath)) {
        throw new Error("Could not resolve path to cover template HTML.");
      }
      this.content.push({
        id: `item_${this.content.length}`,
        href: "cover.xhtml",
        title: "cover",
        data: "",
        url: null,
        author: [],
        filePath: path.resolve(this.tempEpubDir, `./OEBPS/cover.xhtml`),
        templatePath,
        excludeFromToc: true,
        beforeToc: true,
        isCover: true,
      });
    }
    // Parse contents & save media
    const contentTemplatePath = path.resolve(__dirname, "../templates/content.xhtml.ejs");
    const contentOffset = this.content.length;
    this.content.push(...options.content.map((content, i) => {
      const index = contentOffset + i;
      // Get the content URL & path
      let href, filePath;
      if (content.filename === undefined) {
        const prepend = `${index}_`;
        const titleSlug = slug(content.title || "no title", prepend.length + 6);
        href = `${prepend}${titleSlug}.xhtml`;
        filePath = path.resolve(this.tempEpubDir, `./OEBPS/${index}_${titleSlug}.xhtml`);
      }
      else {
        href = content.filename.match(/\.xhtml$/) ? content.filename : `${content.filename}.xhtml`;
        if (content.filename.match(/\.xhtml$/)) {
          filePath = path.resolve(this.tempEpubDir, `./OEBPS/${content.filename}`);
        }
        else {
          filePath = path.resolve(this.tempEpubDir, `./OEBPS/${content.filename}.xhtml`);
        }
      }
      // Content ID & directory
      const id = `item_${index}`;
      const dir = path.dirname(filePath);
      // Parse the content
      const html = loadHtml(content.data, [
        () => (tree) => {
          const validateElements = (node) => {
            const attrs = node.properties;
            if (["img", "br", "hr"].includes(node.tagName)) {
              if (node.tagName === "img") {
                node.properties.alt = node.properties?.alt || "image-placeholder";
              }
            }
            for (const k of Object.keys(attrs)) {
              if (this.allowedAttributes.includes(k)) {
                if (k === "type") {
                  if (attrs[k] !== "script") {
                    delete node.properties[k];
                  }
                }
                else if (k === "controls") {
                  if (attrs[k] === true) {
                    node.properties[k] = "Controls";
                  }
                }
              }
              else {
                delete node.properties[k];
              }
            }
            if (this.version === 2) {
              if (!this.allowedXhtml11Tags.includes(node.tagName)) {
                if (this.verbose) {
                  console.log("Warning (content[" + index + "]):", node.tagName, "tag isn't allowed on EPUB 2/XHTML 1.1 DTD.");
                }
                node.tagName = "div";
              }
            }
          };
          visit(tree, "element", validateElements);
        },
        () => (tree) => {
          const processMediaTags = (node) => {
            const url = node.properties.src;
            if (url === undefined || url === null) {
              return;
            }
            let mediaArray;
            let subfolder;
            if (["img", "input"].includes(node.tagName)) {
              mediaArray = this.images;
              subfolder = "images";
            }
            else if (this.version !== 2 && ["audio", "video"].includes(node.tagName)) {
              mediaArray = this.audioVideo;
              subfolder = "audiovideo";
            }
            else {
              return;
            }
            let extension, id;
            const media = mediaArray.find((element) => element.url === url);
            if (media) {
              id = media.id;
              extension = media.extension;
            }
            else {
              id = uuid();
              const mediaType = mime.getType(url.replace(/\?.*/, ""));
              if (mediaType === null) {
                if (this.verbose) {
                  console.error("[Image Error]", `The media can't be processed : ${url}`);
                }
                return;
              }
              extension = mime.getExtension(mediaType);
              if (extension === null) {
                if (this.verbose) {
                  console.error("[Image Error]", `The media can't be processed : ${url}`);
                }
                return;
              }
              mediaArray.push({ id, url, dir, mediaType, extension });
            }
            node.properties.src = `${subfolder}/${id}.${extension}`;
          };
          visit(tree, "element", processMediaTags);
        },
      ]);
      // Return the EpubContent
      return {
        id,
        href,
        title: content.title,
        data: html,
        url: content.url ?? null,
        author: content.author ? (typeof content.author === "string" ? [content.author] : content.author) : [],
        filePath,
        templatePath: contentTemplatePath,
        excludeFromToc: content.excludeFromToc === true, // Default to false
        beforeToc: content.beforeToc === true, // Default to false
        isCover: false,
      };
    }));
  }

  async render() {
    // Create directories
    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir);
    }
    mkdirSync(this.tempEpubDir);
    mkdirSync(path.resolve(this.tempEpubDir, "./OEBPS"));
    if (this.verbose) {
      console.log("Downloading Media...");
    }
    await this.downloadAllMedia(this.images, this.audioVideo);
    if (this.verbose) {
      console.log("Making Cover...");
    }
    await this.makeCover();
    if (this.verbose) {
      console.log("Generating Template Files.....");
    }
    await this.generateTempFile(this.content);
    if (this.verbose) {
      console.log("Generating Epub Files...");
    }
    await this.generate();
    if (this.verbose) {
      console.log("Done.");
    }
    return { result: "ok" };
  }

  async generateTempFile(contents) {
    // Create the document's Header
    const docHeader = this.version === 2
      ? `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="${this.lang}">
`
      : `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${this.lang}">
`;
    // Copy the CSS style
    if (!this.css) {
      this.css = readFileSync(path.resolve(__dirname, "../templates/template.css"), { encoding: "utf8" });
    }
    writeFileSync(path.resolve(this.tempEpubDir, "./OEBPS/style.css"), this.css);
    // Copy fonts
    if (this.fonts.length) {
      mkdirSync(path.resolve(this.tempEpubDir, "./OEBPS/fonts"));
      this.fonts = this.fonts.map((font) => {
        if (!existsSync(font)) {
          throw new Error(`Custom font not found at ${font}.`);
        }
        const filename = path.basename(font);
        copyFileSync(font, path.resolve(this.tempEpubDir, `./OEBPS/fonts/${filename}`));
        return filename;
      });
    }
    // Write content files
    for (const content of contents) {
      const result = await renderFile(content.templatePath, {
        ...this,
        ...content,
        bookTitle: this.title,
        encodeXML,
        docHeader,
      }, {
          escape: (markup) => markup,
        });
      writeFileSync(content.filePath, result);
    }
    // write meta-inf/container.xml
    mkdirSync(this.tempEpubDir + "/META-INF");
    writeFileSync(`${this.tempEpubDir}/META-INF/container.xml`, '<?xml version="1.0" encoding="UTF-8" ?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    if (this.version === 2) {
      // write meta-inf/com.apple.ibooks.display-options.xml [from pedrosanta:xhtml#6]
      writeFileSync(`${this.tempEpubDir}/META-INF/com.apple.ibooks.display-options.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<display_options>
<platform name="*">
<option name="specified-fonts">true</option>
</platform>
</display_options>
`);
    }
    const opfPath = this.customOpfTemplatePath || path.resolve(__dirname, `../templates/epub${this.version}/content.opf.ejs`);
    if (!existsSync(opfPath)) {
      throw new Error("Custom file to OPF template not found.");
    }
    writeFileSync(path.resolve(this.tempEpubDir, "./OEBPS/content.opf"), await renderFile(opfPath, this));
    if (this.version === 2) {
      const ncxTocPath = this.customNcxTocTemplatePath || path.resolve(__dirname, "../templates/epub2/toc.ncx.ejs");
      if (!existsSync(ncxTocPath)) {
        throw new Error("Custom file the NCX toc template not found.");
      }
      writeFileSync(path.resolve(this.tempEpubDir, "./OEBPS/toc.ncx"), await renderFile(ncxTocPath, this));
    }
    const htmlTocPath = this.customHtmlTocTemplatePath || path.resolve(__dirname, `../templates/epub${this.version}/toc.xhtml.ejs`);
    if (!existsSync(htmlTocPath)) {
      throw new Error("Custom file to HTML toc template not found.");
    }
    writeFileSync(path.resolve(this.tempEpubDir, "./OEBPS/toc.xhtml"), await renderFile(htmlTocPath, this));
  }

  async makeCover() {
    if (this.cover === null) {
      return;
    }
    const destPath = path.resolve(this.tempEpubDir, `./OEBPS/cover.${this.coverExtension}`);
    try {
      await downloadFile(this.cover, destPath, true);
    } catch (err) {
      if (this.verbose) {
        console.error(`The cover image can't be processed : ${this.cover}, ${err}`);
      }
      return;
    }
    if (this.verbose) {
      console.log("[Success] cover image downloaded successfully!");
    }
    const sizeOf = promisify(imageSize);
    // Retrieve image dimensions
    const result = await sizeOf(destPath);
    if (!result || !result.width || !result.height) {
      throw new Error(`Failed to retrieve cover image dimensions for "${destPath}"`);
    }
    this.coverDimensions.width = result.width;
    this.coverDimensions.height = result.height;
    if (this.verbose) {
      console.log(`cover image dimensions: ${this.coverDimensions.width} x ${this.coverDimensions.height}`);
    }
  }

  async downloadMedia(media, subfolder) {
    const filename = path.resolve(this.tempEpubDir, `./OEBPS/${subfolder}/${media.id}.${media.extension}`);
    try {
      if (media.url.startsWith('file://' + this.tempDir)) {
        // if file is already temporary, just move it
        renameSync(media.url.substring(7), filename);
        return;
      }
      await downloadFile(media.url, filename);
    } catch (err) {
      if (this.verbose) {
        console.error(`The media can't be processed : ${media.url}, ${err}`);
      }
    }
  }

  async downloadAllMedia(images, audioVideo) {
    if (images.length > 0) {
      mkdirSync(path.resolve(this.tempEpubDir, "./OEBPS/images"));
      for (let index = 0; index < images.length; index++) {
        await this.downloadMedia(images[index], "images");
      }
    }
    if (audioVideo.length > 0) {
      mkdirSync(path.resolve(this.tempEpubDir, "./OEBPS/audiovideo"));
      for (let index = 0; index < audioVideo.length; index++) {
        await this.downloadMedia(audioVideo[index], "audiovideo");
      }
    }
  }

  generate() {
    // Thanks to Paul Bradley
    // http://www.bradleymedia.org/gzip-markdown-epub/ (404 as of 28.07.2016)
    // Web Archive URL:
    // http://web.archive.org/web/20150521053611/http://www.bradleymedia.org/gzip-markdown-epub
    // or Gist:
    // https://gist.github.com/cyrilis/8d48eef37fbc108869ac32eb3ef97bca
    const cwd = this.tempEpubDir;
    return new Promise((resolve, reject) => {
      const archive = archiver("zip", { zlib: { level: 9 } });
      const output = createWriteStream(this.output);
      if (this.verbose) {
        console.log("Zipping temp dir to", this.output);
      }
      archive.append("application/epub+zip", { store: true, name: "mimetype" });
      archive.directory(cwd + "/META-INF", "META-INF");
      archive.directory(cwd + "/OEBPS", "OEBPS");
      archive.pipe(output);
      archive.on("end", () => {
        if (this.verbose) {
          console.log("Done zipping, clearing temp dir...");
        }
        output.end(() => {
          rmSync(cwd, { recursive: true, force: true });
          resolve();
        });
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      archive.on("error", (err) => reject(err));
      archive.finalize();
    });
  }
}
