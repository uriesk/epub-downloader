import path from 'path'
import fs from 'fs';
import { createHash } from 'crypto'
import { fileURLToPath } from "url";

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

import getMedia from './src/yt-dlp.js';
import { EPub } from './src/html-to-epub.js';
import {
  getHostOfUrl,
  uuid,
  slug,
  fixZip,
}from './src/utils.js';

const __dirname = fileURLToPath(new URL(".", import.meta.url));

async function replaceIFrame(document, frame, options) {
  const tempFolder = options.tempInstanceDir;
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

async function checkQuotesForMedia(document, quote, options) {
  const tempFolder = options.tempInstanceDir;
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

export async function manipulateDOM(parsedContent, options, purify = true) {
  console.log('Checking embedded content.');
  const document = parsedContent.dom.document;
  /* remove iframes */
  for (const f of document.querySelectorAll('iframe')) {
    await replaceIFrame(document, f, options);
  }
  /* get videos from twitter blockquotes */
  for (const q of document.querySelectorAll('blockquote')) {
    await checkQuotesForMedia(document, q, options);
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
    const titlestring = slug(title, 5 + 11);
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
    tempDir: options.tempInstanceDir,
    hideToC: true,
  };
  const epub = new EPub(epubOptions, output);
  await epub.render();
  return output;
}

async function fetchAsEpub(options) {
  if (!options.url) {
    return false;
  }
  if (!options.tempDir) {
    options.tempDir = path.resolve(__dirname, 'tmp');
  }
  if (!fs.existsSync(options.tempDir)) {
    fs.mkdirSync(options.tempDir);
  }
  options.tempInstanceDir = path.resolve(options.tempDir, uuid());
  if (!fs.existsSync(options.tempInstanceDir)) {
    fs.mkdirSync(options.tempInstanceDir);
  }
  const cleanup = () => {
    fs.rmSync(options.tempInstanceDir, { recursive: true, force: true });
  };
  process.on('SIGINT', () => {
    console.log('Cleaning up...');
    cleanup();
    process.exit(128);
  });
  process.on('SIGTERM', () => {
    console.log('Cleaning up...');
    cleanup();
    process.exit(128);
  });

  try {
    let parsedContent = await getDOM(options.url);
    parsedContent = await manipulateDOM(parsedContent, options);
    const filepath = await createEpub(parsedContent, options);
    /* fixZip uses the zip shell utility to rewrite the file
      * it can be useful when the node zipping out is questionable
      */
    // await fixZip(filepath, options.tempInstanceDir).catch(() =>{});
  } catch (err) {
    console.error(err.message);
    cleanup();
    return false
  }
  cleanup();
  return true;
}

export default fetchAsEpub;
