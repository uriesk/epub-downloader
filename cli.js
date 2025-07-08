#!/usr/bin/env node

import fetchAsEpub from './index.js';
import getArgsFromCli from './src/parse-args.js';

const options = getArgsFromCli();

fetchAsEpub(options);
