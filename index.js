#!/usr/bin/env node

import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs';

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';
import { EPub } from '@lesjoursfr/html-to-epub';

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

export async function getDOM(url, purify = false) {
  if (!url) {
    throw new Error('No URL given');
  }
  let html = await fetch(url).then((r) => r.text());
  /* purify strips too much here, so we default to false */
  if (purify) {
    const window = new JSDOM('', {url}).window;
    const purify = DOMPurify(window);
    html = purify.sanitize(html);
  }
  /* create DOM */
  const doc = new JSDOM(html, {url});
  /* parse with readability */
  const reader = new Readability(doc.window.document);
  return reader.parse();
}

export async function createEpub(parsedContent, options) {
  const title = parsedContent.title;
  if (!title) {
    throw new Error('Could not find any title');
  }
  let siteName = parsedContent.siteName;
  if (!siteName) siteName = new URL(options.url).host;
  if (siteName.startsWith('www.')) siteName = siteName.substring(4);
  if (siteName.endsWith('.com')) siteName = siteName.substring(0, siteName.length - 4);
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

  const epubOptions = {
    title,
    author,
    publisher: siteName,
    output,
    lang: parsedContent.lang?.substring(0, 2),
    content: [{
      title,
      data: parsedContent.content,
    }, {
      title: 'References',
      data: `<p>Published on: <em>${publishedDate.toUTCString()}</em> by <em>${author}</em> at <a href="${options.url}">${siteName}</a>.</p><p>Fetched on: <em>${new Date().toUTCString()}</em>.</p>`
    }],
    cover: options.cover,
    hideToC: true,
  };
  const epub = new EPub(epubOptions, output);
  return epub.render();
}

async function fetchAsEpub(options) {
  const dom = await getDOM(options.url);
  return createEpub(dom, options);
}

if (isRunAsCli()) {
  const options = getArgsFromCli();
  fetchAsEpub(options).catch((err) => {
    console.error(err.message);
    process.exit(255);
  });
}

export default fetchAsEpub;
