import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outLogPath = path.join(root, 'dev-server.out.log');
const errLogPath = path.join(root, 'dev-server.err.log');
const envPath = path.join(root, '.env');

const viteBin = process.platform === 'win32'
  ? path.join(root, 'node_modules', '.bin', 'vite.cmd')
  : path.join(root, 'node_modules', '.bin', 'vite');

const userArgs = process.argv.slice(2);
const hasHostArg = userArgs.some((arg, index) => arg === '--host' || arg.startsWith('--host=') || userArgs[index - 1] === '--host');
const hasClearScreenArg = userArgs.some((arg, index) => arg === '--clearScreen' || arg.startsWith('--clearScreen=') || userArgs[index - 1] === '--clearScreen');
const viteArgs = [
  ...userArgs,
  ...(hasHostArg ? [] : ['--host', '127.0.0.1']),
  ...(hasClearScreenArg ? [] : ['--clearScreen', 'false']),
];

const ansiPattern = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function parseDotEnvValue(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    const unquoted = trimmed.slice(1, -1);
    return quote === '"'
      ? unquoted.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
      : unquoted;
  }
  return trimmed.replace(/\s+#.*$/g, '');
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const env = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const normalized = line.startsWith('export ') ? line.slice(7).trimStart() : line;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = parseDotEnvValue(normalized.slice(separatorIndex + 1));
  }

  return env;
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function cleanLine(line) {
  return line
    .replace(ansiPattern, '')
    .replace(/\r/g, '')
    .replace(/^(?:上午|下午)?\s*\d{1,2}:\d{2}:\d{2}\s+\[vite\]\s*/u, '[vite] ')
    .replace(/\s+$/g, '');
}

function writeHeader() {
  const header = [
    '# Slicer Labeler Dev Server',
    `# Started: ${stamp()}`,
    `# Command: vite ${viteArgs.join(' ')}`,
    '',
  ].join('\n');
  fs.writeFileSync(outLogPath, header, 'utf8');
  fs.writeFileSync(errLogPath, header, 'utf8');
}

function createWriter(logPath, stream, level) {
  let buffered = '';

  function write(line) {
    const clean = cleanLine(line);
    if (!clean.trim()) return;

    const row = `${stamp()} | ${level.padEnd(5)} | ${clean}\n`;
    fs.appendFileSync(logPath, row, 'utf8');
    if (stream.isTTY) {
      stream.write(row);
    }
  }

  return {
    chunk(data) {
      buffered += data.toString('utf8');
      const lines = buffered.split(/\n/);
      buffered = lines.pop() || '';
      lines.forEach(write);
    },
    flush() {
      if (buffered) {
        write(buffered);
        buffered = '';
      }
    },
  };
}

writeHeader();

const outWriter = createWriter(outLogPath, process.stdout, 'info');
const errWriter = createWriter(errLogPath, process.stderr, 'error');
const dotEnv = loadDotEnv(envPath);

const child = spawn(viteBin, viteArgs, {
  cwd: root,
  env: {
    ...dotEnv,
    ...process.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    npm_config_color: 'false',
  },
  windowsHide: true,
});

child.stdout.on('data', (data) => outWriter.chunk(data));
child.stderr.on('data', (data) => errWriter.chunk(data));

child.on('error', (err) => {
  errWriter.chunk(`${err.stack || err.message}\n`);
});

child.on('close', (code, signal) => {
  outWriter.flush();
  errWriter.flush();
  const reason = signal ? `signal ${signal}` : `exit code ${code}`;
  const line = `Dev server stopped with ${reason}`;
  const target = code === 0 ? outWriter : errWriter;
  target.chunk(`${line}\n`);
  process.exit(code ?? 1);
});

function shutdown(signal) {
  outWriter.chunk(`Received ${signal}, stopping dev server...\n`);
  child.kill(signal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
