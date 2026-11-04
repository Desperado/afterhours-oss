// Shared browser fixtures: a mocked library recording served with byte ranges, so
// specs never depend on recordings in the developer's own .context/tracks.

// Mono 16-bit silence at 8 kHz.
function silentWav(seconds) {
  const dataBytes = 8000 * 2 * seconds,
    wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

function fixtureTrack(fields = {}) {
  return {
    id: 'fixture',
    title: 'Fixture',
    format: 'WAV',
    duration: 60,
    sample_rate: 8000,
    channels: 1,
    waveform: Array(360).fill(0.5),
    rms_dbfs: -18,
    peak_dbfs: -3,
    sessions: [],
    summary: null,
    ...fields,
  };
}

async function routeAudio(page, id, wav) {
  await page.route(`**/api/tracks/${id}/audio`, r => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(r.request().headers().range || '');
    const start = range ? Number(range[1]) : 0,
      end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    return r.fulfill({
      status: range ? 206 : 200,
      contentType: 'audio/wav',
      headers: {'Accept-Ranges': 'bytes', ...(range ? {'Content-Range': `bytes ${start}-${end}/${wav.length}`} : {})},
      body: wav.subarray(start, end + 1),
    });
  });
}

module.exports = {silentWav, fixtureTrack, routeAudio};
