import fs from "fs";
import path from 'path';
import { spawn } from 'child_process';
import { Readable } from "stream";
import { pipeline } from 'stream/promises';

export async function downloadFile(url, filepath, relativePathToLocalFile = false) {
  if (url.startsWith('file://')) {
    fs.copyFileSync(url.substring(7), filepath);
    return;
  }
  if (!url.includes('://')) {
    if (relativePathToLocalFile) {
      fs.copyFileSync(url, filepath);
    }
    return;
  }
  console.log('Downloading', url);

  const resp = await fetch(url,{
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.105 Safari/537.36',
    },
  });
  if (resp.ok && resp.body) {
    const writer = fs.createWriteStream(filepath);
    const reader = Readable.fromWeb(resp.body);
    await pipeline(reader, writer);
  }
}

export function slug(string, reserved = 0) {
    return string.replaceAll(' ', '-').toLowerCase().replace(/[^0-9a-z-_]/g, '').substring(0, 255 - reserved);
}

export function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getHostOfUrl(url) {
  let  host = new URL(url).host;
  if (host.startsWith('www.')) host = host.substring(4);
  if (host.endsWith('.com')) host = host.substring(0, host.length - 4);
  return host;
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

// Allowed HTML attributes & tags
export const defaultAllowedAttributes = [
  "content",
  "alt",
  "id",
  "title",
  "src",
  "href",
  "about",
  "accesskey",
  "aria-activedescendant",
  "aria-atomic",
  "aria-autocomplete",
  "aria-busy",
  "aria-checked",
  "aria-controls",
  "aria-describedat",
  "aria-describedby",
  "aria-disabled",
  "aria-dropeffect",
  "aria-expanded",
  "aria-flowto",
  "aria-grabbed",
  "aria-haspopup",
  "aria-hidden",
  "aria-invalid",
  "aria-label",
  "aria-labelledby",
  "aria-level",
  "aria-live",
  "aria-multiline",
  "aria-multiselectable",
  "aria-orientation",
  "aria-owns",
  "aria-posinset",
  "aria-pressed",
  "aria-readonly",
  "aria-relevant",
  "aria-required",
  "aria-selected",
  "aria-setsize",
  "aria-sort",
  "aria-valuemax",
  "aria-valuemin",
  "aria-valuenow",
  "aria-valuetext",
  "className",
  "content",
  "contenteditable",
  "contextmenu",
  "controls",
  "datatype",
  "dir",
  "draggable",
  "dropzone",
  "hidden",
  "hreflang",
  "id",
  "inlist",
  "itemid",
  "itemref",
  "itemscope",
  "itemtype",
  "lang",
  "media",
  "ns1:type",
  "ns2:alphabet",
  "ns2:ph",
  "onabort",
  "onblur",
  "oncanplay",
  "oncanplaythrough",
  "onchange",
  "onclick",
  "oncontextmenu",
  "ondblclick",
  "ondrag",
  "ondragend",
  "ondragenter",
  "ondragleave",
  "ondragover",
  "ondragstart",
  "ondrop",
  "ondurationchange",
  "onemptied",
  "onended",
  "onerror",
  "onfocus",
  "oninput",
  "oninvalid",
  "onkeydown",
  "onkeypress",
  "onkeyup",
  "onload",
  "onloadeddata",
  "onloadedmetadata",
  "onloadstart",
  "onmousedown",
  "onmousemove",
  "onmouseout",
  "onmouseover",
  "onmouseup",
  "onmousewheel",
  "onpause",
  "onplay",
  "onplaying",
  "onprogress",
  "onratechange",
  "onreadystatechange",
  "onreset",
  "onscroll",
  "onseeked",
  "onseeking",
  "onselect",
  "onshow",
  "onstalled",
  "onsubmit",
  "onsuspend",
  "ontimeupdate",
  "onvolumechange",
  "onwaiting",
  "prefix",
  "property",
  "rel",
  "resource",
  "rev",
  "role",
  "spellcheck",
  "style",
  "tabindex",
  "target",
  "title",
  "type",
  "typeof",
  "vocab",
  "xml:base",
  "xml:lang",
  "xml:space",
  "colspan",
  "rowspan",
  "epub:type",
  "epub:prefix",
];

// allowed tagNames for epub version 2
export const defaultAllowedXhtml11Tags = [
  "div",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "address",
  "hr",
  "pre",
  "blockquote",
  "center",
  "ins",
  "del",
  "a",
  "span",
  "bdo",
  "br",
  "em",
  "strong",
  "dfn",
  "code",
  "samp",
  "kbd",
  "bar",
  "cite",
  "abbr",
  "acronym",
  "q",
  "sub",
  "sup",
  "tt",
  "i",
  "b",
  "big",
  "small",
  "u",
  "s",
  "strike",
  "basefont",
  "font",
  "object",
  "param",
  "img",
  "table",
  "caption",
  "colgroup",
  "col",
  "thead",
  "tfoot",
  "tbody",
  "tr",
  "th",
  "td",
  "embed",
  "applet",
  "iframe",
  "img",
  "map",
  "noscript",
  "ns:svg",
  "object",
  "script",
  "table",
  "tt",
  "var",
];


