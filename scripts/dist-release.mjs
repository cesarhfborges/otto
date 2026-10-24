// Empacota Linux (AppImage + deb) e Windows (NSIS) com a versão do package.json;
// com `--mac` (só no macOS), gera dmg + zip para Intel e Apple Silicon.
// Pré-releases (`-beta.N`) saem como "Otto Beta": outro appId, nome e pacote, para
// conviverem com a versão final na mesma máquina, e publicam no canal de update `beta`.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const beta = version.includes('-beta');
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['--linux', '--win'];

const overrides = beta
    ? [
          '-c.appId=dev.otto.app.beta',
          '-c.productName=Otto Beta',
          '-c.extraMetadata.productName=Otto Beta',
          '-c.linux.executableName=otto-beta',
          '-c.deb.packageName=otto-beta',
          '-c.nsis.shortcutName=Otto Beta',
          '-c.nsis.uninstallDisplayName=Otto Beta',
          // Gera `beta*.yml` (não `latest*.yml`): só instalações beta enxergam essas versões.
          '-c.publish.channel=beta'
      ]
    : [];

console.log(`Packaging Otto ${version}${beta ? ' (beta)' : ''}: ${targets.join(' ')}`);

const result = spawnSync('npx', ['electron-builder', ...targets, '--publish', 'never', ...overrides], { stdio: 'inherit', shell: process.platform === 'win32' });

process.exit(result.status ?? 1);
