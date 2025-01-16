import path from 'path'
import fs from 'fs';
import { createHash } from 'crypto'
import { fileURLToPath } from "url";

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

import { EPub } from './src/html-to-epub.js';
import {
  getHostOfUrl,
  uuid,
  slug,
  fixZip,
} from './src/utils.js';
import {
  prepareDomForReadability, prepareDomForEpub,
} from './src/dom_filters.js';

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export async function getDOM(options) {
  const url = options.url;
  if (!url) {
    throw new Error('No URL given');
  }
  console.log('Fetching website.');
  let html = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.105 Safari/537.36',
    },
  }).then((r) => r.text());
  let window
  /* create DOM */
  window = new JSDOM(html, {url, pretendToBeVisual: true}).window;
  /* modify before readability */
  await prepareDomForReadability(window.document, options);
  /* parse with readability */
  console.log('Parsing website in reader mode');
  const reader = new Readability(window.document);
  const parsedContent = reader.parse();
  // console.log(parsedContent.content);
  parsedContent.dom = new JSDOM(parsedContent.content, {url}).window;
  return parsedContent;
}

export async function manipulateDOM(parsedContent, options, purify = true) {
  console.log('Checking embedded content.');
  const document = parsedContent.dom.document;
  /* modify before epub saving */
  await prepareDomForEpub(document, options);
  /* get reasonable entry point for epub content */
  let entryNode = parsedContent.dom.document.body;
  while (entryNode.childNodes.length === 1 && entryNode.firstChild.nodeName === 'DIV') {
    entryNode = entryNode.firstChild;
  }
  parsedContent.content = entryNode.innerHTML;
  /* 
   * purify html, keep file:// links of media elements
   * cause we might have saved them
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
    options.output = output;
  }
  const hash = createHash('sha256').update(parsedContent.textContent).digest('hex');

  const epubOptions = {
    title,
    author,
    publisher: siteName,
    output,
    source: options.url,
    date: publishedDate,
    description: parsedContent.excerpt,
    firstImageIsCover: true,
    lang: parsedContent.lang?.substring(0, 2),
    content: [{
      title,
      data: parsedContent.content,
    }, {
      title: 'References',
      data: `<p>Published on: <em><span id="publishedDate">${publishedDate.toUTCString()}</span></em> by <em>${author}</em> at <a id="url" href="${options.url}">${siteName}</a>.</p><p>Fetched on: <em><span id="fetchedDate">${new Date().toUTCString()}</span></em>.</p><p>SHA256 Content Hash: <em><span id="hash">${hash}</span></em></p>`,
      type: 'backmatter appendix',
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
    let parsedContent = await getDOM(options);
    parsedContent = await manipulateDOM(parsedContent, options);
    const filepath = await createEpub(parsedContent, options);
  } catch (err) {
    console.error(err.message);
    cleanup();
    return false
  }
  cleanup();
  console.log('Successfully created', options.output);
  return true;
}

export default fetchAsEpub;
