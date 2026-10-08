import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get current date in format YYYY-MM-DD
const now = new Date();
const dateStr = now.toISOString().split('T')[0];

// Create installers directory with date
const installersDir = path.join(__dirname, '..', 'installers', dateStr);
if (!fs.existsSync(installersDir)) {
  fs.mkdirSync(installersDir, { recursive: true });
}

// Source directories
const msiSource = path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'bundle', 'msi');
const nsisSource = path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'bundle', 'nsis');

// Read current version so only freshly built installers are copied
const tauriConf = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'),
);
const version = tauriConf.version;

// Copy only the latest MSI installer (TutorApp_0.2.0_x64_en-US.msi)
if (fs.existsSync(msiSource)) {
  const msiFiles = fs.readdirSync(msiSource).filter(f => f.endsWith('.msi') && f.includes(version));
  msiFiles.forEach(file => {
    const src = path.join(msiSource, file);
    const dest = path.join(installersDir, file);
    fs.copyFileSync(src, dest);
    console.log(`Copied ${file} to ${installersDir}`);
  });
}

// Copy only the latest NSIS installer (TutorApp_0.2.0_x64-setup.exe)
if (fs.existsSync(nsisSource)) {
  const nsisFiles = fs.readdirSync(nsisSource).filter(f => f.endsWith('-setup.exe') && f.includes(version));
  nsisFiles.forEach(file => {
    const src = path.join(nsisSource, file);
    const dest = path.join(installersDir, file);
    fs.copyFileSync(src, dest);
    console.log(`Copied ${file} to ${installersDir}`);
  });
}

console.log(`Installers moved to: ${installersDir}`);
