// Tile PNGs into one contact sheet: node scripts/sheet.mjs out.png a.png b.png ...
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const [out, ...inputs] = process.argv.slice(2);
const cols = Math.min(4, inputs.length);
const rows = Math.ceil(inputs.length / cols);
const args = inputs.flatMap((f) => ['-i', f]);
const scaled = inputs.map((_, i) => `[${i}:v]scale=600:-1[s${i}]`).join(';');
const stack = inputs.map((_, i) => `[s${i}]`).join('');
const layout = inputs.map((_, i) => `${(i % cols) * 600}_${Math.floor(i / cols)}*h0`.replace('*h0', '') ).join('|');
const grid = inputs.map((_, i) => `${(i % cols) === 0 ? '0' : Array.from({ length: i % cols }, () => 'w0').join('+')}_${Math.floor(i / cols) === 0 ? '0' : Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+')}`).join('|');
void layout; void rows;
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args, '-filter_complex', `${scaled};${stack}xstack=inputs=${inputs.length}:layout=${grid}:fill=white`, out]);
console.log(out);
