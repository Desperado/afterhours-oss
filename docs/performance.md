# Sampler and display performance

Reference: `f4aab06` (merged PR #9), compared with the bounded loader and display
changes on `Desperado/sampler-performance`. Measurements were taken on the same
Apple Silicon Mac with installed Google Chrome, at 1440 × 960. They are local
observations, not guarantees for other machines or browser versions.

## Sample preparation

Three fresh browser contexts per arrangement, with the installed real FLAC banks.
Each context starts with an empty decoded instrument cache. The OS disk cache was
not cleared, so these are not cold disk or whole-application launch measurements.
Times include manifest fetching, recording fetching and decoding at the unchanged
32 kHz playback rate.

| Arrangement | Before, median | After, median | Speedup | Decoded bytes, unchanged |
| --- | ---: | ---: | ---: | ---: |
| Private ensemble fixture | 3136.7 ms | 827.7 ms | 3.79× | 569,857,176 |
| Private band fixture | 3948.0 ms | 1096.9 ms | 3.60× | 587,128,600 |

Ensemble before: 3232.8, 3136.7, 2957.6 ms; after: 964.6, 827.7, 785.3 ms.
Band before: 4058.1, 3948.0, 3725.1 ms; after: 1224.5, 1039.7, 1096.9 ms.
Already prepared banks return in approximately 0–0.3 ms in these runs.

The loader uses 16 concurrent recording jobs shared across missing banks, rather
than decoding each bank's recordings serially. Successful banks are published
together, and all workers finish before a failed call rejects. Concurrent callers
are serialized to keep accounting consistent. The 1536 MiB resident decoded-bank
budget remains; in-flight decoding can temporarily allocate additional memory.
Velocity layers, recorded alternates and stereo channels are retained.

The original arrangement fixtures and benchmark runner are preserved in the private
content repository's archive. These historical measurements require those fixtures
and their installed recordings to reproduce; the public synth demos are different
workloads. Public loader checks run with `node --test tests/instruments.test.js`.

## Browser rendering work

Five-second Chrome DevTools performance samples with the private ensemble fixture loaded:

| State | Main-thread task time, before → after | Script time, before → after | Canvas clears | DOM mutations |
| --- | ---: | ---: | ---: | ---: |
| Idle | 137.3 → 89.8 ms | 44.1 → 21.3 ms | 114 → 0 | 1380 → 36 |
| Playing | 539.5 → 413.3 ms | 110.8 → 83.7 ms | 115 → 83 | 14181 → 5255 |
| Stopped, tails settling | 112.1 → 96.2 ms | 56.5 → 31.3 ms | 114 → 25 | 1380 → 36 |
| Playing, another workspace visible | 202.6 → 144.4 ms | 94.8 → 56.0 ms | 0 → 0 | 14178 → 4897 |

Playing main-thread task time fell about 23% in this sample. Guarded DOM writes,
less frequent visual updates, and skipping inactive panels reduce recurring work.
Settled silent meters do not redraw. Hidden meters do not read waveform snapshots.
Reduced motion slows the display to four updates per second. A post-volume
AudioWorklet scans each stereo render quantum for peaks and sends only per-channel
maxima, at most 20 messages per second (none for silence). The UI retains those
maxima until the next meter read. This catches transients between drawing updates;
the worklet's output is silent and adds no duplicate speaker signal. If it cannot
load, waveform snapshots remain available without continuous peak coverage.
The measurements above predate this peak-accumulator review fix; its small ongoing
audio-thread cost has not been included in those before/after numbers.
Audio scheduling remains independent of the display update rate.

These timings measure browser main-thread work, not total application CPU or
hardware GPU utilization. Fewer canvas redraws reduce rendering work, but no
hardware GPU utilization reduction is claimed from these counters.

## Packaged application CPU samples

The arm64 Electron app was measured before and after with a fresh local profile,
the private ensemble fixture loaded, and the default meter. Each state settled for 2.5 seconds,
then supplied three 3-second process CPU samples. Medians from Electron's
`app.getAppMetrics()` are shown below.

| State | Renderer CPU %, before → after | GPU process CPU %, before → after |
| --- | ---: | ---: |
| Idle | 0.397 → 0.206 | 0.336 → 0.072 |
| Playing | 2.284 → 2.112 | 1.420 → 1.294 |
| Stopped, tails settling | 0.782 → 0.501 | 0.356 → 0.075 |
| Playing, another workspace visible | 1.701 → 1.319 | 0.162 → 0.158 |

These short local samples show lower renderer CPU use, especially when idle.
The GPU column measures CPU consumed by Electron's GPU process, not hardware
GPU utilization. Playback position, effect tails and other machine activity can
change the results; this is not a sustained-load or battery-life benchmark.

## Verification

Loader tests exercise shared callers, atomic publication, failed-worker draining,
retry and the cross-bank memory limit. Browser checks cover distinct L/R signals,
output volume, mono upmixing, independent clipping/peak holds, all six faces,
visible VU/scope held values, brief inter-frame overloads with reduced motion,
silent meter-tap output, remembered preferences, silent redraws and hidden-panel
sampling. Real-bank playback and full-song exports check the private arrangements when their recordings are installed.
