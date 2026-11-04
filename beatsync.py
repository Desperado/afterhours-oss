"""Local beat timing for the browser groovebox. No model calls or uploads."""

import numpy as np
import soundfile as sf


def detect(path):
    import librosa

    rate, hop = 22050, 256
    envelopes, timestamps = [], []
    with sf.SoundFile(path) as source:
        duration = source.frames / source.samplerate
        if not 4 <= duration <= 1200 or source.channels > 2 or source.samplerate > 192000:
            raise ValueError("Auto sync needs 4 seconds to 20 minutes of mono or stereo audio, up to 192 kHz.")
        # Bound the spectrogram's memory even for a 20-minute recording.
        for offset in range(0, source.frames, source.samplerate * 30):
            samples = source.read(source.samplerate * 30, dtype="float32", always_2d=True)
            if not np.isfinite(samples).all():
                raise ValueError("The recording contains invalid samples.")
            channel = int(np.argmax(np.mean(samples.astype(np.float64) ** 2, axis=0)))
            mono = librosa.resample(samples[:, channel], orig_sr=source.samplerate, target_sr=rate)
            if len(mono) < 2048:
                continue
            onset = librosa.onset.onset_strength(y=mono, sr=rate, hop_length=hop)
            # Ignore the artificial onset at each block boundary.
            onset[:4] = 0
            envelopes.append(onset)
            timestamps.append(offset / source.samplerate + np.arange(len(onset)) * hop / rate)
    envelope = np.interp(np.arange(0, duration, hop / rate), np.concatenate(timestamps), np.concatenate(envelopes))
    if float(np.max(envelope)) < 0.05:
        raise ValueError("No clear beat found. Try a rhythmic recording or set BPM manually.")
    _, frames = librosa.beat.beat_track(onset_envelope=envelope, sr=rate, hop_length=hop, trim=True)
    beats = librosa.frames_to_time(frames, sr=rate, hop_length=hop)
    if len(beats) < 8:
        raise ValueError("Not enough clear beats. Try a longer rhythmic recording or set BPM manually.")
    bpm = 60 / float(np.median(np.diff(beats)))
    if not 40 <= bpm <= 240:
        raise ValueError("Detected tempo is outside 40–240 BPM. Set BPM manually.")
    return {
        "bpm": round(bpm, 2),
        "beats": np.round(beats, 6).tolist(),
        "duration": duration,
        "method": "local_beat_tracking",
    }
