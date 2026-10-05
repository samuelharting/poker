// Crop + upscale a region of a screenshot: node scripts/crop-fp.mjs in.png out.png x y w h [scale]
import sharp from 'sharp'
const [input, output, x, y, w, h, scale = '2'] = process.argv.slice(2)
await sharp(input).extract({ left: +x, top: +y, width: +w, height: +h }).resize({ width: Math.round(+w * +scale) }).toFile(output)
