# Contact sheet of every Nth recorded frame: python scripts/montage-social.py <dir> <prefix> <out.png> [step] [cols] [crop=x0,y0,x1,y1]
import sys, glob
from PIL import Image
d, prefix, out = sys.argv[1], sys.argv[2], sys.argv[3]
step = int(sys.argv[4]) if len(sys.argv) > 4 else 6
cols = int(sys.argv[5]) if len(sys.argv) > 5 else 3
crop = tuple(int(v) for v in sys.argv[6].split(',')) if len(sys.argv) > 6 else None
files = sorted(glob.glob(f'{d}/{prefix}-*.jpg'))[::step]
imgs = [Image.open(f) for f in files]
if crop: imgs = [i.crop(crop) for i in imgs]
w, h = imgs[0].size
sc = min(1.0, 1400 / (cols * w))
tw, th = int(w * sc), int(h * sc)
rows = (len(imgs) + cols - 1) // cols
sheet = Image.new('RGB', (tw * cols, th * rows), 'black')
for n, im in enumerate(imgs):
    sheet.paste(im.resize((tw, th)), ((n % cols) * tw, (n // cols) * th))
sheet.save(out)
print(len(imgs), sheet.size)
