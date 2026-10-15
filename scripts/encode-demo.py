"""Encode unmodified desktop screenshot frames into an operation demonstration."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageSequence

frames = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
images = [Image.open(frame['path']).convert('RGB') for frame in frames]
duration = [max(40, min(800, round(b['time'] - a['time']))) for a, b in zip(frames, frames[1:])] + [1200]
images[0].save(sys.argv[2], save_all=True, append_images=images[1:], duration=duration, loop=0, optimize=False, disposal=2)
for image in images:
    image.close()

with Image.open(sys.argv[2]) as animation:
    duration = sum(frame.info.get('duration', 0) for frame in ImageSequence.Iterator(animation))
    print(json.dumps({'frames': animation.n_frames, 'width': animation.width, 'height': animation.height, 'durationMs': duration}))
