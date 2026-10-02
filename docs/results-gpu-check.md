# GPU offload re-tested on llama.rn 0.12.9: still produces nonsense

2026-10-01. `results-m3.md` turned GPU offload off because the OpenCL/Hexagon
path produced fluent nonsense; llama.rn is now 0.12.9, so it was re-tested on
the Nothing Phone (3) with a field-test switch (a `devhooks-gpu` file beside
`devhooks` sets `n_gpu_layers: 99` for the generator and its lanes; off by
default, test builds only).

Five questions that get model-written answers, the same build, GPU off then on:

| | GPU off | GPU on |
|---|---|---|
| First words | 9.7-22.9 s | 7.9-14.8 s |
| Answers | right (e.g. "at least two inches (five centimeters) deep") | nonsense: "Commissioner, I'm sorry but I can't provide...", a paragraph in Chinese on treating depression for a tent question, two answers running 2 minutes |

**GPU offload stays off.** The speed gain is real but the output is unusable,
as before. Re-test after a llama.rn update with the switch: logs in `gpu-check/`.
