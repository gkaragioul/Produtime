const { execSync } = require('child_process');
const path = require('path');

const exePath = path.join(
  __dirname,
  '..',
  'release',
  'win-unpacked',
  'ProduTime.exe'
);
const iconPath = path.join(__dirname, '..', 'assets', 'favicon.ico');

console.log('Updating ProduTime.exe icon...');
console.log('EXE Path:', exePath);
console.log('Icon Path:', iconPath);

try {
  // Use rcedit from electron-winstaller
  const rceditPath = path.join(
    __dirname,
    '..',
    'node_modules',
    'electron-winstaller',
    'vendor',
    'rcedit.exe'
  );

  execSync(`"${rceditPath}" "${exePath}" --set-icon "${iconPath}"`, {
    stdio: 'inherit',
  });

  console.log('✅ Icon updated successfully!');
} catch (error) {
  console.error('❌ Failed to update icon:', error.message);
  process.exit(1);
}
