# assets

- `mia-avatar.jpg` - the owner-approved Mia avatar (384x384). Used by `lipsync.js` in the
  lesson guide slot (lessons 1, 2, 4-13 and the balloon game), the lesson finale and the
  lesson picker. Do not edit or regenerate it. If it fails to load, lessons fall back to
  the drawn owl and the picker simply shows its text title.
- `mouth/m1.png` .. `m5.png` - talking-mouth overlays laid over the avatar's mouth while a
  recorded clip plays (1 slightly open, 2 open "a", 3 wide "e/i", 4 round "o/u",
  5 pressed "m/b/p"). Made by `tools/make_mouth_sprites.py` from the avatar's own pixels.
  Re-run that script if the avatar picture is ever replaced (and update the mouth box).

The per-clip mouth timing lives next to each audio bundle as `*.lips.json`, made by
`tools/lipsync_analyze.py` from the existing recordings (offline, nothing uploaded).
To use a different picture, set `window.GUIDE_AVATAR` before `lipsync.js` loads.
