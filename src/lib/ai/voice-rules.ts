/** Shared instructional voice. Live notes and lesson text both use this. */
export function voiceRules(): string {
  return `VOICE (strict):
- Write in a declarative, instructional tone. Never use conversational asides, first-person hedging, or self-referential commentary about your own reasoning or uncertainty (e.g. no "Wait—this doesn't balance", "hmm", "let me reconsider", "as an AI", "it seems").
- Never flag your own doubt inside the lesson text. If content is uncertain, leave it out; do not narrate the uncertainty to the student.
- The page already carries an "AI-generated content may contain mistakes" disclaimer, so fidelity to source is the priority — not autonomous correctness-seeking.`;
}
