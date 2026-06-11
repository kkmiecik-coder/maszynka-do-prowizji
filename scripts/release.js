// Publikacja wydania na GitHub Releases.
// Wczytuje token GH_TOKEN z pliku .env (NIE commitowanego — patrz .gitignore),
// po czym uruchamia electron-builder z publikacją. Dzięki temu nie trzeba ręcznie
// ustawiać zmiennej środowiskowej przed każdym wydaniem.
//
// Plik .env (w katalogu głównym projektu) powinien zawierać jedną linię:
//   GH_TOKEN=github_pat_xxxxx
//
// Uruchom: npm run release:win
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const envPath = join(root, '.env');

// Prosty parser .env (bez zależności): KEY=VALUE, pomija puste linie i # komentarze.
function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Zdejmij ewentualne cudzysłowy wokół wartości.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const fileEnv = loadEnv(envPath);
const token = process.env.GH_TOKEN || fileEnv.GH_TOKEN;

if (!token) {
  console.error('\n✗ Brak GH_TOKEN.');
  console.error('  Utwórz plik .env w katalogu projektu z linią:');
  console.error('    GH_TOKEN=github_pat_twoj_token');
  console.error('  Token wygenerujesz na: https://github.com/settings/tokens');
  console.error('  (fine-grained, repo maszynka-do-prowizji, Contents: Read and write)\n');
  process.exit(1);
}

console.log('• Token wczytany, uruchamiam electron-builder (publikacja na GitHub)…\n');

// Cel platformy z argumentu (--win domyślnie), reszta argumentów przekazywana dalej.
const extraArgs = process.argv.slice(2);
const args = ['electron-builder', ...(extraArgs.length ? extraArgs : ['--win']), '--publish', 'always'];

const res = spawnSync('npx', args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, GH_TOKEN: token },
  shell: process.platform === 'win32', // na Windows npx wymaga powłoki
});

process.exit(res.status ?? 1);
