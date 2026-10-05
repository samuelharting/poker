// Contact sheet of cropped screenshots: node scripts/montage-fp.mjs out.png cols x y w h scale in1.png in2.png ...
import sharp from 'sharp'
const [output, cols, x, y, w, h, scale, ...inputs] = process.argv.slice(2)
const cw = Math.round(+w * +scale)
const ch = Math.round(+h * +scale)
const tiles = await Promise.all(inputs.map(file => sharp(file).extract({ left: +x, top: +y, width: +w, height: +h }).resize({ width: cw }).png().toBuffer()))
const rows = Math.ceil(tiles.length / +cols)
await sharp({ create: { width: cw * +cols, height: ch * rows, channels: 3, background: '#000' } })
  .composite(tiles.map((input, index) => ({ input, left: (index % +cols) * cw, top: Math.floor(index / +cols) * ch })))
  .png().toFile(output)
