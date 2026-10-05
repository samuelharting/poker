# Contact sheet of a drink sequence: python scripts/drink-sheet.py <dir> <kind> <out.png> [cols] [scale]
import sys, glob
from PIL import Image, ImageDraw
d, kind, out = sys.argv[1], sys.argv[2], sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4
scale = float(sys.argv[5]) if len(sys.argv) > 5 else 0.5
files = sorted(glob.glob(f"{d}/{kind}-*.png"))
imgs = [Image.open(f).convert("RGB") for f in files]
if not imgs: sys.exit("no frames")
w, h = imgs[0].size
w, h = int(w * scale), int(h * scale)
rows = (len(imgs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w, rows * h), (20, 20, 20))
for i, (f, im) in enumerate(zip(files, imgs)):
    im = im.resize((w, h), Image.LANCZOS)
    ImageDraw.Draw(im).text((6, 4), f.split("-")[-1][:-4] + "s", fill=(255, 255, 0))
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(out)
print(out, sheet.size)
