import getMedia from './yt-dlp.js';
import { getHostOfUrl } from './utils.js';

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

async function replaceIFrames(document, options) {
  for (const f of document.querySelectorAll('iframe')) {
    await replaceIFrame(document, f, options);
  }
}

async function checkQuoteForMedia(document, quote, options) {
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
    media.src = filepath;
    media.setAttribute("controls","controls");
    p.appendChild(media);
    if (quote.nextSibling) {
      quote.parentNode.insertBefore(p, quote.nextSibling);
    } else {
      quote.parentNode.appendChild(p);
    }
  } catch (err) {
    console.error(err.message);
    return;
  }
}

async function checkQuotesForMedia(document, options) {
  for (const q of document.querySelectorAll('blockquote')) {
    await checkQuoteForMedia(document, q, options);
  }
}

async function chooseSourceOfMedia(document, p, typePriority) {
  let chosenSource;
  let chosenType;
  let chosenSize;
  let altText;
  for (const s of p.childNodes) {
    if (s.tagName === 'IMG' && p.tagName === 'PICTURE') {
      altText = s.alt;
      if (s.src && !s.src.startsWith('data:')) {
        chosenSource = s.src;
        break;
      }
    } else if (s.tagName === 'SOURCE') {
      if ((s.srcset || s.src) && !chosenSource || typePriority.indexOf(s.type) < typePriority.indexOf(chosenType)) {
        chosenType = s.type;
        chosenSize = 0;
        let sources = s.src;
        if (!sources || sources.startsWith('data:')) {
          sources = s.srcset;
        }
        if (!sources || sources.startsWith('data:')) {
          sources = s.getAttribute('data-srcset');
        }
        if (!sources || sources.startsWith('data:')) {
          continue;
        }

        for (const ss of sources.split(',')) {
          let srcstr = ss.trim();
          if (srcstr.includes('.m3u8')) {
            continue;
          }
          let size;
          const space = srcstr.indexOf(' ');
          if (space === -1) {
            chosenSource = srcstr;
            break;
          }
          size = parseInt(srcstr.substring(space + 1), 10);
          srcstr = srcstr.substring(0, space);
          if (Number.isNaN(size)) {
            chosenSource = srcstr;
            break;
          }
          if (size >= chosenSize) {
            chosenSize = size;
            chosenSource = srcstr;
          }
        }
      }
    } else if (s.tagName) {
      return {};
    }
  }
  if (chosenSource) {
    return {
      src: chosenSource,
      alt: altText,
    }
  }
  return {};
}

/*
  * check for picture elements that have no source set in their img child,
  * or no img child at all, choose a source and replace it with an img
  */
async function chooseSourceOfPictures(document) {
  const typePriority = ['image/png', 'image/jpeg', 'image/webp', 'image/jxl', 'image/avif'];
  for (const p of document.querySelectorAll('picture')) {
    const { src, alt } = await chooseSourceOfMedia(document, p, typePriority);
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      if (alt) {
        img.alt = alt;
      }
      p.parentNode.replaceChild(img, p);
    }
  }
}

/*
  * chooses source of video element with multiple sources
  */
async function chooseSourceOfVideos(document) {
  for (const p of document.querySelectorAll('video')) {
    if (!p.src) {
      const { src } = await chooseSourceOfMedia(document, p, []);
      if (src) {
        const media = document.createElement('video');
        media.src = src;
        media.appendChild(document.createTextNode('There is video content at this location that is not currently supported on your device.'));
        media.setAttribute("controls","controls");
        if (p.title) {
          media.title = p.title;
        }
        p.parentNode.replaceChild(media, p);
      }
    }
  }
}

export async function prepareDomForReadability(document, options) {
  await chooseSourceOfPictures(document, options);
  await chooseSourceOfVideos(document, options);
}

export async function prepareDomForEpub(document, options) {
  await replaceIFrames(document, options);
  await checkQuotesForMedia(document, options);
}
