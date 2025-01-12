#!/usr/bin/env node

import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs';
import { spawn } from 'child_process';
import { createHash } from 'crypto'

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';
import { EPub } from '@lesjoursfr/html-to-epub';
import YTDlpWrap from 'yt-dlp-wrap';

const ytDlpWrap = new YTDlpWrap.default();

function isRunAsCli() {
  const nodePassedPath = process.argv[1];
  if (!nodePassedPath) return false;
  const pathPassedToNode = path.resolve(nodePassedPath)
  const pathToThisFile = path.resolve(fileURLToPath(import.meta.url));
  return pathToThisFile.includes(pathPassedToNode)
}

function getArgsFromCli() {
  const options = {};
  const { argv } = process;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('-')) {
      switch (arg) {
        case '-h':
        case '--help': {
          console.log('Usage: node ./index.js [-o output_filename] [-p path] [-s] [url-to-article]\n');
          console.log('-o, --output\tFilepath for the epub');
          console.log('-p, --path\tPath for the epub, filename will be automatically generated, only effective if -o not given');
          console.log('-s, --create_subfolders\tCreate subfolders by sitename, only effective if -o not given');
          console.log('-m, --download_media\tDownload embedded youtube videos and include them (yt-dlp needs to be installed and in $PATH)');
          console.log('-f, --media_format\tFormat string used by yt-dlp, only effective if -m is set');
          console.log('--media_filesize\tMaximum file size of the media to download in MiB, only effective if -m is set');
          console.log('-c, --cover\tURL to a cover image');
          process.exit(0);
        }
        case '-o':
        case '--output': {
          i += 1;
          const output = argv[i];
          if (!output || output.startsWith('-')) {
            console.error(`${arg} expects a filename`);
            process.exit(3);
          }
          options.output = output;
          break;
        }
        case '-p':
        case '--path': {
          i += 1;
          const pathArg = argv[i];
          if (!pathArg || pathArg.startsWith('-')) {
            console.error(`${arg} extects a path`);
            process.exit(4);
          }
          options.path = pathArg;
          break;
        }
        case '-s':
        case '--create_subfolders': {
          options.createSubfolders = true;
          break;
        }
        case '-c':
        case '--cover': {
          i += 1;
          const cover = argv[i];
          if (!cover || cover.startsWith('-')) {
            console.error(`${arg} extects a URL to a cover image`);
            process.exit(5);
          }
          options.cover = cover;
          break;
        }
        case '-m':
        case '--download_media': {
          options.downloadMedia = true;
          break;
        }
        case '-f':
        case '--media_format': {
          i += 1;
          const mediaFormat = argv[i];
          if (!mediaFormat || mediaFormat.startsWith('-')) {
            console.error(`${arg} extects a yt-dlp format string`);
            process.exit(6);
          }
          options.mediaFormat = mediaFormat;
          break;
        }
        case '--media_filesize': {
          i += 1;
          const targetFileSize = argv[i];
          if (!targetFileSize || targetFileSize.startsWith('-')) {
            console.error(`${arg} extects a number as target filesize`);
            process.exit(6);
          }
          options.targetFileSize = targetFileSize;
          break;
        }
        default: {
          console.error(`Unrecognized option: ${arg}`);
          process.exit(1);
        }
      }
    } else {
      if (options.url) {
        console.error(`Ambigious argument: ${arg}`);
        process.exit(2);
      }
      options.url = arg;
    }
  }
  return options;
}

function randomString() {
  return Math.random().toString(36).substr(2, 10);
}

function getHostOfUrl(url) {
  let  host = new URL(url).host;
  if (host.startsWith('www.')) host = host.substring(4);
  if (host.endsWith('.com')) host = host.substring(0, host.length - 4);
  return host;
}

function getMedia(src, tempFolder, formats, targetFileSize = null, attempt = 0) {
  const format = formats[attempt];
  console.log(`Try downloading video  ${src} as: ${format}`);
  let filepath;
  do {
    const extension = (format.includes('video') || format.includes('best[') || format.includes('b[') || format.includes('bc') || format.includes('wv') || format === 'best')
      ? '.mp4' : '.m4a';
    const filename = randomString() + extension;
    filepath = path.resolve(tempFolder, filename);
  } while (fs.existsSync(filepath));
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let killed = false;
    ytDlpWrap
    .exec([
        src,
        '-f',
        format,
        '-o',
        filepath,
    ], {}, controller.signal)
    .on('ytDlpEvent', (eventType, eventData) => {
        if (killed || !targetFileSize || eventType !== 'download') {
          return;
        }
        const stats = eventData.match(/([0-9]+\.[0-9]+)([KMG]iB)/);
        if (stats?.length !== 3) {
          return;
        }

        let multiplier = 1;
        switch (stats[2]) {
          case 'KiB':
            multiplier /= 1024;
            break;
          case 'TiB':
            multiplier *= 1024;
          case 'GiB':
            multiplier *= 1024;
            break;
        }
        const fileSize = parseInt(stats[1]) * multiplier;
        if (fileSize > targetFileSize) {
          if (attempt + 1 < formats.length) {
            console.log('File too large');
            killed = true;
            controller.abort();
          }
        }
      })
    .on('error', (err) => {
        if (err.message.includes('Requested format is not available.')) {
          attempt += 1;
          if (attempt < formats.length) {
            console.log('Format not available.');
            getMedia(src, tempFolder, formats, targetFileSize, attempt)
              .then(resolve)
              .catch(reject);
            return;
          }
        }
        reject(err);
      })
    .on('close', () => {
        if (killed) {
          attempt += 1;
          if (attempt < formats.length) {
            getMedia(src, tempFolder, formats, targetFileSize, attempt)
              .then(resolve)
              .catch(reject);
            return;
          }
        }
        resolve(`file://${filepath}`);
      });
  });
}

async function replaceIFrame(document, frame, tempFolder, options) {
  const src = frame.src;
  const host = getHostOfUrl(src);
  let node = frame;
  /* go to outermost node that has a different sibling */
  while (node.parentNode.childNodes.length <= 1) {
    node = node.parentNode;
  }

  let replacement;
  const a = document.createElement('a');
  a.href = src;
  if (options.downloadMedia && ['youtube', 'youtu.be'].includes(host)) {
    a.appendChild(document.createTextNode(`Watch on ${host}.`));
    replacement = document.createElement('figure');
    const preferedFormats = ['worstvideo[vcodec!*=av01][height>=?420]+bestaudio[acodec!*=opus][abr<120]','worstvideo[vcodec!*=av01][height>=?360]+bestaudio[acodec!*=opus][abr<120]', 'worstvideo+worstaudio'];
    const filepath = await getMedia(
      src,
      tempFolder,
      (options.mediaFormat && options.mediaFormat.split('_')) || preferedFormats, 
      options.targetFileSize,
    );
    const type = filepath.endsWith('.mp4') ? 'video' : 'audio';
    const media = document.createElement(type);
    media.style.maxWidth = '100%';
    media.src = filepath;
    media.appendChild(document.createTextNode(`There is ${type} content at this location that is not currently supported on your device.`));
    media.setAttribute("controls","controls");
    replacement.appendChild(media);
    const caption = document.createElement('figcaption');
    caption.appendChild(a);
    replacement.appendChild(caption);
  } else {
    a.appendChild(document.createTextNode(`Visit ${host}.`));
    replacement = document.createElement('p');
    replacement.appendChild(a);
  }
  node.parentNode.replaceChild(replacement, node);
}

async function checkQuotesForMedia(document, quote, tempFolder, options) {
  let lastChild;
  if (!options.downloadMedia
    || !quote.parentNode
    ||quote.lastChild?.tagName !== 'P'
    || quote.lastChild.lastChild?.tagName !== 'A'
  ) {
    return;
  }
  const url = quote.lastChild.lastChild.href;
  if (getHostOfUrl(url) !== 'twitter') {
    return;
  }
  /* we don't know if the tweet includes a video, we just try */
  try {
    const preferedFormats = ['worstvideo[vcodec!*=av01][height>=?420]+bestaudio[abr<120]', 'worstvideo+worstaudio', 'bestaudio[abr<120]'];
    const filepath = await getMedia(
      url,
      tempFolder,
      (options.mediaFormat && options.mediaFormat.split('_')) || preferedFormats,
      options.targetFileSize,
    );
    const type = filepath.endsWith('.mp4') ? 'video' : 'audio';
    const media = document.createElement(type);
    const p = document.createElement('p');
    media.style.maxWidth = '100%';
    media.src = filepath;
    media.setAttribute("controls","controls");
    p.appendChild(media);
    if (quote.nextSibling) {
      quote.parentNode.insertBefore(p, quote.nextSibling);
    } else {
      quote.parentNode.appendChild(p);
    }
  } catch (err) {
    console.log(err.message);
    return;
  }
}

export async function getDOM(url) {
  if (!url) {
    throw new Error('No URL given');
  }
  console.log('Fetching website.');
  let html = await fetch(url).then((r) => r.text());
  let window
  /* create DOM */
  window = new JSDOM(html, {url}).window;
  /* parse with readability */
  console.log('Parsing website in reader mode');
  const reader = new Readability(window.document);
  const parsedContent = reader.parse();
  parsedContent.dom = new JSDOM(parsedContent.content, {url}).window;
  return parsedContent;
}

export async function manipulateDOM(parsedContent, tempFolder, options, purify = true) {
  console.log('Checking embedded content.');
  const document = parsedContent.dom.document;
  /* remove iframes */
  for (const f of document.querySelectorAll('iframe')) {
    await replaceIFrame(document, f, tempFolder, options);
  }
  /* get videos from twitter blockquotes */
  for (const q of document.querySelectorAll('blockquote')) {
    await checkQuotesForMedia(document, q, tempFolder, options);
  }
  parsedContent.content = parsedContent.dom.document.body.innerHTML;
  /* 
   * purify html, keep file:// links of media elements
   * cause we might have safed them
   * */
  if (purify) {
    const url = parsedContent.dom.document.location.href;
    const purify = DOMPurify(new JSDOM('', { url }).window);
    purify.addHook(
      'uponSanitizeAttribute',
      (currentNode, hookEvent, config) => {
        if (['VIDEO', 'AUDIO', 'IMG', 'IMAGE'].includes(currentNode.tagName)
          && hookEvent.attrName === 'src'
          && hookEvent.attrValue.startsWith('file://')
        ) {
          hookEvent.forceKeepAttr = true;
        }
      }
    );
    parsedContent.content = purify.sanitize(parsedContent.content);
    parsedContent.dom = new JSDOM(parsedContent.content, { url }).window;
  }
  return parsedContent;
}

export async function createEpub(parsedContent, options) {
  console.log('Creating epub');
  const title = parsedContent.title;
  if (!title) {
    throw new Error('Could not find any title');
  }
  let siteName = parsedContent.siteName;
  if (!siteName) siteName = getHostOfUrl(options.url);
  let author = parsedContent.byline;
  if (author?.startsWith('by ')) author = author.substring(3);
  if (!author) author = siteName;
  const publishedDate = parsedContent.publishedTime
    ? new Date(parsedContent.publishedTime) : new Date();
  let output = options.output;
  if (!output) {
    const datestring = `${publishedDate.getUTCFullYear()}-${`0${publishedDate.getUTCMonth() + 1}`.slice(-2)}-${`0${publishedDate.getUTCDate()}`.slice(-2)}`
    const titlestring = title.replaceAll(' ', '-').toLowerCase().replace(/[^0-9a-z-_]/g, '').substring(0, 255 - 5 - 11);
    const filename = `${datestring}_${titlestring}.epub`;
    let pathArg = options.path || '.';
    if (options.createSubfolders && siteName) {
      pathArg = path.join(pathArg, siteName);
      if (!fs.existsSync(pathArg)) {
        fs.mkdirSync(pathArg);
      }
    }
    output = path.join(pathArg, filename);
  }
  const hash = createHash('sha256').update(parsedContent.textContent).digest('hex');

  const epubOptions = {
    title,
    author,
    publisher: siteName,
    output,
    firstImageIsCover: true,
    lang: parsedContent.lang?.substring(0, 2),
    content: [{
      title,
      data: parsedContent.content,
    }, {
      title: 'References',
      data: `<p>Published on: <em><span id="publishedDate">${publishedDate.toUTCString()}</span></em> by <em>${author}</em> at <a id="url" href="${options.url}">${siteName}</a>.</p><p>Fetched on: <em><span id="fetchedDate">${new Date().toUTCString()}</span></em>.</p><p>SHA256 Content Hash: <em><span id="hash">${hash}</span></em></p>`,
    }],
    cover: options.cover,
    hideToC: true,
  };
  const epub = new EPub(epubOptions, output);
  await epub.render();
  return output;
}

export function fixZip(filepath, tempFolder) {
  return new Promise((resolve, reject) => {
    const tempFile = path.resolve(tempFolder, 'fix.zip');
    const zipProcess = spawn('zip', ['-F', filepath, '--out', tempFile]);
    zipProcess.stdout.on('data', function(msg){
        console.log(msg.toString());
    });
    zipProcess.on('error', reject);
    zipProcess.on('close', (code) => {
      if (code === 0) {
        fs.copyFileSync(tempFile, filepath);
        resolve();
      } else {
        reject(new Error('zip -F failed'));
      }
    });
  });
}

async function fetchAsEpub(options) {
  const tempFolder = path.resolve('/tmp', `audiovideo-${randomString()}`);
  if (!fs.existsSync(tempFolder)) {
    fs.mkdirSync(tempFolder);
  }

  let parsedContent = await getDOM(options.url);
  parsedContent = await manipulateDOM(parsedContent, tempFolder, options);
  const filepath = await createEpub(parsedContent, options);
  await fixZip(filepath, tempFolder).catch(() =>{});

  fs.rmSync(tempFolder, { recursive: true, force: true });
  return;
}

if (isRunAsCli()) {
  const options = getArgsFromCli();
  fetchAsEpub(options).catch((err) => {
    console.error(err.message);
    process.exit(255);
  });
}

export default fetchAsEpub;
