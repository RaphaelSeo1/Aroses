import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  VOICE_TURN_WINDOW_MS,
  isChargedVoiceTurn,
  voiceMeterSnapshot,
} from "./voice-turn.ts";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const PERIOD = "2026-09-01T00:00:00.000Z";
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

test("a voice-mode turn skips chat only while voice minutes are being charged", () => {
  const charged = { remainingSeconds: 600, lastChargedAt: minutesAgo(1) };
  assert.equal(isChargedVoiceTurn({ voiceMode: true, meter: charged, now: NOW }), true);
  // The client flag alone is not enough.
  assert.equal(isChargedVoiceTurn({ voiceMode: false, meter: charged, now: NOW }), false);
  assert.equal(isChargedVoiceTurn({ voiceMode: true, meter: null, now: NOW }), false);
  // Voice time used up → TTS answers 402 and the runner drops to text.
  assert.equal(
    isChargedVoiceTurn({ voiceMode: true, meter: { ...charged, remainingSeconds: 0 }, now: NOW }),
    false
  );
  // Nothing spoken recently → counts as chat.
  const stale = { ...charged, lastChargedAt: minutesAgo(VOICE_TURN_WINDOW_MS / 60_000 + 1) };
  assert.equal(isChargedVoiceTurn({ voiceMode: true, meter: stale, now: NOW }), false);
  assert.equal(
    isChargedVoiceTurn({ voiceMode: true, meter: { ...charged, lastChargedAt: null }, now: NOW }),
    false
  );
});

test("voice meter snapshot ignores rows from an older period or with nothing charged", () => {
  const row = {
    period_start: PERIOD,
    seconds_used: 120,
    bonus_seconds: 30,
    updated_at: minutesAgo(2),
  };
  assert.deepEqual(voiceMeterSnapshot({ row, periodStartIso: PERIOD, capSeconds: 600 }), {
    remainingSeconds: 510,
    lastChargedAt: row.updated_at,
  });
  assert.equal(
    voiceMeterSnapshot({ row: { ...row, period_start: "2026-08-01T00:00:00.000Z" }, periodStartIso: PERIOD, capSeconds: 600 }),
    null
  );
  assert.equal(
    voiceMeterSnapshot({ row: { ...row, seconds_used: 0 }, periodStartIso: PERIOD, capSeconds: 600 }),
    null
  );
  assert.equal(voiceMeterSnapshot({ row: null, periodStartIso: PERIOD, capSeconds: 600 }), null);
});

const VOICE_ROUTES = [
  "src/app/api/mentored/turn-stream/route.ts",
  "src/app/api/mentored/turn/route.ts",
  "src/app/api/tutor-session/[sessionId]/turn-stream/route.ts",
];

for (const file of VOICE_ROUTES) {
  test(`${file} passes the voice-mode flag to the chat meter`, () => {
    const src = readFileSync(file, "utf8");
    assert.match(
      src,
      /reserveChatMessage\(user, \{\s*voiceMode: body\.voiceMode === true,\s*\}\)/
    );
  });
}

test("voice minutes are charged where the runners speak Rose's reply", () => {
  const tts = readFileSync("src/app/api/voice-tutor/tts/route.ts", "utf8");
  assert.match(tts, /recordVoiceSeconds\(/);
  const voice = readFileSync("src/lib/mentored/use-mentored-voice.ts", "utf8");
  assert.match(voice, /fetch\("\/api\/voice-tutor\/tts"/);
  for (const runner of [
    "src/components/immersive/ImmersiveLessonRunner.tsx",
    "src/components/tutor-session/TutorSessionRunner.tsx",
  ]) {
    assert.match(
      readFileSync(runner, "utf8"),
      /voiceMode: interactionModeRef\.current === "voice"/,
      runner
    );
  }
});

test("calendar Ask Rose is not metered as chat", () => {
  const src = readFileSync("src/app/api/calendar/chat/route.ts", "utf8");
  assert.doesNotMatch(src, /reserveChatMessage|chat-usage|chatModelOverride/);
  const lib = readFileSync("src/lib/ai/calendar-chat.ts", "utf8");
  assert.doesNotMatch(lib, /input\.model/);
});
