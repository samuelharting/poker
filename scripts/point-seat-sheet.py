# Contact sheet of snap-point-seats output: rows = times, columns = views, for one seat.
# Usage: python scripts/point-seat-sheet.py <dir> <seat> <out.png> [views=front,side,back,over] [scale=0.5]
import sys, glob, os, re
from PIL import Image, ImageDraw
d, seat, out = sys.argv[1], sys.argv[2], sys.argv[3]
views = (sys.argv[4] if len(sys.argv) > 4 else 'front,side,back,over').split(',')
scale = float(sys.argv[5]) if len(sys.argv) > 5 else 0.5
times = sorted({re.search(r'-t([\d.]+)-', os.path.basename(f)).group(1) for f in glob.glob(os.path.join(d, f's{seat}-t*-*.png'))}, key=float)
first = Image.open(glob.glob(os.path.join(d, f's{seat}-t*-*.png'))[0])
w, h = int(first.width * scale), int(first.height * scale)
sheet = Image.new('RGB', (w * len(views), h * len(times)))
for r, t in enumerate(times):
    for c, v in enumerate(views):
        p = os.path.join(d, f's{seat}-t{t}-{v}.png')
        if os.path.exists(p):
            im = Image.open(p).convert('RGB').resize((w, h))
            ImageDraw.Draw(im).text((6, 4), f'seat {seat} t={t} {v}', fill=(255, 255, 0))
            sheet.paste(im, (c * w, r * h))
sheet.save(out)
print(out, sheet.size)
