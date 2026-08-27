"use client";

/**
 * Lecture audio → Deepgram as raw linear16 PCM.
 *
 * MediaRecorder/Opus is the wrong pipe: DTX treats quiet (and sometimes
 * not-so-quiet) classroom / tab-share speech as silence. Raw PCM has no
 * silence gate. Tab/system capture is already a digital mix — pass it
 * through. The mic path uses adaptive AGC so a lecturer across the room
 * still crosses Deepgram's energy floor without clipping a loud PA.
 */

export const LECTURE_PCM_SAMPLE_RATE = 16_000;

export type LecturePcmBoost = "lecture-mic" | "none";

/** Start already a bit hot so the first quiet words aren't lost. */
const AGC_INITIAL_GAIN = 8;
/**
 * Allow attenuation: a loud, clear lecture must be able to go below 1×
 * or the samples clip and Deepgram drops words.
 */
const AGC_MIN_GAIN = 0.35;
/**
 * ~46 dB. Past this you only amplify the laptop's own hiss; Deepgram starts
 * inventing words from HVAC / keyboard.
 */
const AGC_MAX_GAIN = 200;
const AGC_TARGET_RMS = 0.18;
/** Skip AGC math only for true digital silence (divide-by-zero), not speech. */
const AGC_SILENCE = 1e-6;

type PcmTap = {
  sampleRate: typeof LECTURE_PCM_SAMPLE_RATE;
  stop: () => void;
};

const WORKLET_NAME = "lecture-mic-pcm";

const WORKLET_SOURCE = `
class LectureMicPcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const mode =
      options && options.processorOptions && options.processorOptions.mode;
    this._agc = mode !== "passthrough";
    this._gain = this._agc ? ${AGC_INITIAL_GAIN} : 1;
    this._minGain = ${AGC_MIN_GAIN};
    this._maxGain = ${AGC_MAX_GAIN};
    this._target = ${AGC_TARGET_RMS};
    this._frac = 0;
    this._pending = [];
    this._pendingSamples = 0;
    this._outHop = 1600;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;

    if (this._agc) {
      let sum = 0;
      for (let i = 0; i < input.length; i++) {
        const v = input[i];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / input.length);
      if (rms > ${AGC_SILENCE}) {
        const desired = this._target / rms;
        const clamped = Math.max(this._minGain, Math.min(this._maxGain, desired));
        this._gain = this._gain * 0.85 + clamped * 0.15;
      }
    }

    const step = sampleRate / ${LECTURE_PCM_SAMPLE_RATE};
    let pos = this._frac;
    while (pos < input.length) {
      const i = pos | 0;
      const frac = pos - i;
      const a = input[i] || 0;
      const b = i + 1 < input.length ? input[i + 1] : a;
      let s = (a + (b - a) * frac) * this._gain;
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      this._pending.push(s);
      this._pendingSamples++;
      pos += step;
    }
    this._frac = pos - input.length;

    if (this._pendingSamples >= this._outHop) {
      const n = this._pendingSamples;
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const s = this._pending[i];
        pcm[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
      this._pending = [];
      this._pendingSamples = 0;
    }
    return true;
  }
}
registerProcessor("${WORKLET_NAME}", LectureMicPcmProcessor);
`;

function audioContextCtor(): typeof AudioContext | undefined {
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

function downsample(
  input: Float32Array,
  inRate: number,
  state: { gain: number; frac: number; agc: boolean }
): Int16Array {
  if (state.agc) {
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      const v = input[i]!;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / input.length);
    if (rms > AGC_SILENCE) {
      const desired = AGC_TARGET_RMS / rms;
      const clamped = Math.max(AGC_MIN_GAIN, Math.min(AGC_MAX_GAIN, desired));
      state.gain = state.gain * 0.85 + clamped * 0.15;
    }
  }

  const step = inRate / LECTURE_PCM_SAMPLE_RATE;
  const out: number[] = [];
  let pos = state.frac;
  while (pos < input.length) {
    const i = pos | 0;
    const frac = pos - i;
    const a = input[i] ?? 0;
    const b = i + 1 < input.length ? input[i + 1]! : a;
    let s = (a + (b - a) * frac) * state.gain;
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    out.push(s);
    pos += step;
  }
  state.frac = pos - input.length;

  const pcm = new Int16Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const s = out[i]!;
    pcm[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
  }
  return pcm;
}

/**
 * Tap `stream`'s audio, resample to 16 kHz linear16, and invoke `onPcm`
 * with transferable ArrayBuffers (~100 ms each). Does not play through
 * speakers (that would feedback). Call `stop()` on pause/finish.
 *
 * `boost: "lecture-mic"` — adaptive AGC for a laptop mic in a room.
 * `boost: "none"` — digital tab/system audio, already at the right level.
 */
export async function startLecturePcmTap(
  stream: MediaStream,
  onPcm: (chunk: ArrayBuffer) => void,
  opts?: { boost?: LecturePcmBoost }
): Promise<PcmTap> {
  const boost = opts?.boost ?? "lecture-mic";
  const agc = boost !== "none";
  const Ctor = audioContextCtor();
  if (!Ctor) {
    throw new Error("This browser cannot process lecture audio.");
  }
  const ctx = new Ctor();
  await ctx.resume();

  const source = ctx.createMediaStreamSource(stream);
  // Keep the graph pulling samples without routing to the laptop speakers.
  const sink = ctx.createMediaStreamDestination();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      source.disconnect();
    } catch {
      /* ignore */
    }
    void ctx.close();
  };

  try {
    const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const node = new AudioWorkletNode(ctx, WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { mode: agc ? "agc" : "passthrough" },
    });
    node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      if (stopped) return;
      if (ev.data) onPcm(ev.data);
    };
    source.connect(node);
    node.connect(sink);
    return { sampleRate: LECTURE_PCM_SAMPLE_RATE, stop };
  } catch {
    // AudioWorklet unavailable (older Safari) — ScriptProcessor on the main
    // thread is deprecated but keeps a 90-minute lecture working.
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const state = {
      gain: agc ? AGC_INITIAL_GAIN : 1,
      frac: 0,
      agc,
    };
    processor.onaudioprocess = (ev) => {
      if (stopped) return;
      const input = ev.inputBuffer.getChannelData(0);
      const pcm = downsample(input, ctx.sampleRate, state);
      if (pcm.length === 0) return;
      onPcm(new Int16Array(pcm).buffer);
    };
    source.connect(processor);
    processor.connect(sink);
    return { sampleRate: LECTURE_PCM_SAMPLE_RATE, stop };
  }
}

/** @deprecated Use startLecturePcmTap — kept as a thin alias. */
export async function startLectureMicPcmTap(
  stream: MediaStream,
  onPcm: (chunk: ArrayBuffer) => void
): Promise<PcmTap> {
  return startLecturePcmTap(stream, onPcm, { boost: "lecture-mic" });
}
