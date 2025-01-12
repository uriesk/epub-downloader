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

export default getArgsFromCli;
