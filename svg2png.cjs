const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, 'worldcup-score-odds.svg');
const outPath = path.join(__dirname, 'worldcup-score-odds.png');

const svg = fs.readFileSync(svgPath);

sharp(svg, { density: 150 })
  .resize(2400, 3200)
  .png({ quality: 95, compressionLevel: 9 })
  .toFile(outPath)
  .then(info => {
    console.log('Converted to PNG:', outPath);
    console.log('Size:', info.size, 'bytes');
    console.log('Dimensions:', info.width, 'x', info.height);
  })
  .catch(err => console.error('Error:', err));
