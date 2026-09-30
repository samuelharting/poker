# Realistic Avatar Assets

The local `.glb` files in this folder are copied from Poly Pizza pages for
Quaternius character models. Each page labels the model as `CC0 1.0` / Public
Domain.

Source pages:

- `business-man.glb`: https://poly.pizza/m/JFrLIKqvCH
- `casual-character.glb`: https://poly.pizza/m/kZ3DmIoGip
- `hoodie-character.glb`: https://poly.pizza/m/gKLBoRsyKe
- `worker.glb`: https://poly.pizza/m/Yg2bQZO6Hj
- `punk.glb`: https://poly.pizza/m/BTALZymknF
- `adventurer.glb`: https://poly.pizza/m/5EGWBMpuXq

Direct GLB resources copied on 2026-04-26:

- https://static.poly.pizza/e599abbe-7d73-488c-9d7e-3ead281e705c.glb
- https://static.poly.pizza/90a9e2d4-053f-42f1-99a2-8f5e1180ea7f.glb
- https://static.poly.pizza/bcd66ec5-5e81-4901-a222-47abc875fe2a.glb
- https://static.poly.pizza/3a5f3056-ffe6-42eb-bd52-122afcbd22b2.glb
- https://static.poly.pizza/e56f23b5-3270-406f-8924-f77cad980c43.glb
- https://static.poly.pizza/bbe369ee-a686-42c7-adad-14356f5f2f15.glb

License reference:

- https://creativecommons.org/publicdomain/zero/1.0/

## Slimmed copies

The untouched source downloads live in `assets-src/avatars/`. The files the
app serves from `public/models/avatars/` are generated from them by
`npm run assets:avatars` (`scripts/slim-avatars.mjs`), which keeps only the
animation clips listed in `AVATAR_CLIP_NAMES`
(`components/three/avatarAssetLoader.ts`) and drops the other 20 clips. Meshes,
skins, materials, node names and the kept clips are unchanged, which
`scripts/verify-slim-avatars.mjs` checks.
