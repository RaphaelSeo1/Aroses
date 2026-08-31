import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_ATTACHMENT_ACCEPT_ATTRIBUTE,
  CHAT_ATTACHMENT_UNSUPPORTED_MESSAGE,
  isChatAttachmentKind,
  MAX_CHAT_ATTACHMENTS,
  queueChatAttachmentFiles,
} from "./chat-attachment-formats";
import { detectIngestFormat } from "../study-ingest/formats";

function fakeFile(name: string, type: string, size = 100): File {
  const bytes = new Uint8Array(Math.max(1, size));
  return new File([bytes], name, { type, lastModified: 1 });
}

test("chat accept list covers documents and images, not media", () => {
  assert.match(CHAT_ATTACHMENT_ACCEPT_ATTRIBUTE, /\.pdf/);
  assert.match(CHAT_ATTACHMENT_ACCEPT_ATTRIBUTE, /\.docx/);
  assert.match(CHAT_ATTACHMENT_ACCEPT_ATTRIBUTE, /\.pptx/);
  assert.match(CHAT_ATTACHMENT_ACCEPT_ATTRIBUTE, /\.txt/);
  assert.match(CHAT_ATTACHMENT_ACCEPT_ATTRIBUTE, /\.md/);
  assert.match(CHAT_ATTACHMENT_ACCEPT_ATTRIBUTE, /\.png/);
  assert.doesNotMatch(CHAT_ATTACHMENT_ACCEPT_ATTRIBUTE, /\.mp4/);
  assert.doesNotMatch(CHAT_ATTACHMENT_ACCEPT_ATTRIBUTE, /\.mp3/);
  assert.doesNotMatch(CHAT_ATTACHMENT_ACCEPT_ATTRIBUTE, /\.zip/);
});

test("detectIngestFormat kinds map to chat allow/deny", () => {
  assert.equal(detectIngestFormat("syllabus.pdf"), "pdf");
  assert.equal(detectIngestFormat("notes.docx"), "word");
  assert.equal(detectIngestFormat("lecture.pptx"), "slides");
  assert.equal(detectIngestFormat("readme.txt"), "text");
  assert.equal(detectIngestFormat("notes.md"), "markdown");
  assert.equal(detectIngestFormat("shot.png"), "image");
  assert.equal(isChatAttachmentKind(detectIngestFormat("syllabus.pdf")), true);
  assert.equal(isChatAttachmentKind(detectIngestFormat("clip.mp4")), false);
  assert.equal(isChatAttachmentKind(detectIngestFormat("talk.mp3")), false);
  assert.equal(isChatAttachmentKind(detectIngestFormat("archive.zip")), false);
});

test("queueChatAttachmentFiles accepts document and image types", () => {
  const incoming = [
    fakeFile("syllabus.pdf", "application/pdf"),
    fakeFile("essay.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    fakeFile("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    fakeFile("notes.txt", "text/plain"),
    fakeFile("shot.png", "image/png"),
  ];
  const result = queueChatAttachmentFiles({ incoming, alreadyQueued: [] });
  assert.equal(result.accepted.length, 5);
  assert.equal(result.nextQueued.length, 5);
  assert.equal(result.error, null);
});

test("queueChatAttachmentFiles rejects video/audio/zip with a clear error", () => {
  const video = queueChatAttachmentFiles({
    incoming: [fakeFile("lecture.mp4", "video/mp4")],
    alreadyQueued: [],
  });
  assert.equal(video.accepted.length, 0);
  assert.equal(video.error, CHAT_ATTACHMENT_UNSUPPORTED_MESSAGE);

  const audio = queueChatAttachmentFiles({
    incoming: [fakeFile("talk.mp3", "audio/mpeg")],
    alreadyQueued: [],
  });
  assert.equal(audio.error, CHAT_ATTACHMENT_UNSUPPORTED_MESSAGE);

  const zip = queueChatAttachmentFiles({
    incoming: [fakeFile("pack.zip", "application/zip")],
    alreadyQueued: [],
  });
  assert.equal(zip.error, CHAT_ATTACHMENT_UNSUPPORTED_MESSAGE);
});

test("queueChatAttachmentFiles caps count and still adds allowed files", () => {
  const already = Array.from({ length: MAX_CHAT_ATTACHMENTS }, (_, i) =>
    fakeFile(`a${i}.pdf`, "application/pdf", 10 + i)
  );
  const result = queueChatAttachmentFiles({
    incoming: [fakeFile("extra.pdf", "application/pdf")],
    alreadyQueued: already,
  });
  assert.equal(result.nextQueued.length, MAX_CHAT_ATTACHMENTS);
  assert.match(result.error ?? "", /up to 5 files/);
});
