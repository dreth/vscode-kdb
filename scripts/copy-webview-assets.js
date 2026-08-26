'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceDirectory = path.join(root, 'node_modules', 'uplot', 'dist');
const targetDirectory = path.join(root, 'media', 'uplot');
const assets = [
  'uPlot.iife.min.js',
  'uPlot.min.css',
];

fs.mkdirSync(targetDirectory, { recursive: true });
for (const asset of assets) {
  const source = path.join(sourceDirectory, asset);
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Required uPlot webview asset is missing: ${source}`);
  }
  fs.copyFileSync(source, path.join(targetDirectory, asset));
}
