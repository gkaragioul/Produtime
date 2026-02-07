const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');

const iconPngPath = path.join(__dirname, '..', 'assets', 'icon.png');
const iconIcoPath = path.join(__dirname, '..', 'assets', 'app-icon.ico');

console.log('Converting icon.png to ICO format...');

// Convert PNG to ICO using Jimp
Jimp.read(iconPngPath)
  .then((image) => {
    return image.resize(256, 256).write(iconIcoPath);
  })
  .then(() => {
    console.log('✅ Icon converted successfully to:', iconIcoPath);
  })
  .catch((err) => {
    console.error('❌ Failed to convert icon:', err);
    process.exit(1);
  });
