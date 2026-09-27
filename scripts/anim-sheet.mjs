// Cuts a timestamped contact sheet from a recorded video.
// Usage: node scripts/anim-sheet.mjs <video> <startSec> <seconds> <out.png> [fps] [width] [crop w:h:x:y] [cols]
// Env: FFMPEG=<path to ffmpeg>.
import { execFileSync } from 'node:child_process'
import { relative } from 'node:path'

// drawtext splits options on ':', so the font goes in as a relative path.
export const FONT = relative(process.cwd(), 'C:/Windows/Fonts/arial.ttf').split('\\').join('/')
const STAMP = `drawtext=fontfile=${FONT}:text='%{pts\\:hms}':x=4:y=4:fontsize=13:fontcolor=white:box=1:boxcolor=black@0.55`

/** Contact sheet of `seconds` of video from `start`, one timestamped tile per frame. */
export function sheet(video, start, seconds, out, { fps = 12, width = 400, crop = '', cols = 6, ffmpeg = process.env.FFMPEG ?? 'ffmpeg' } = {}) {
  const rows = Math.ceil(Math.ceil(Number(seconds) * Number(fps)) / Number(cols))
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(start), '-t', String(seconds), '-i', video,
    '-vf', `${crop ? `crop=${crop},` : ''}fps=${fps},scale=${width}:-1,${STAMP},tile=${cols}x${rows}`, '-frames:v', '1', out])
  return out
}

if (process.argv[1] && process.argv[1].endsWith('anim-sheet.mjs')) {
  const [video, start, seconds, out, fps = '12', width = '400', crop = '', cols = '6'] = process.argv.slice(2)
  console.log(sheet(video, Number(start), Number(seconds), out, { fps: Number(fps), width: Number(width), crop, cols: Number(cols) }))
}
