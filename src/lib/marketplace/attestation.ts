import { ATTESTATION_VERSION } from "@/lib/marketplace/types";

export const LISTING_ATTESTATION_ITEMS = [
  "I personally created this course content from my own study materials.",
  "This course does NOT contain copyrighted textbook or publisher content, or my professor's or institution's protected material.",
  "I take full responsibility for what I upload and understand Aroses may remove listings that violate this policy.",
] as const;

export const LISTING_POLICY_SUMMARY =
  "You may only sell courses you personally created from your own original study materials. Do not list content from textbooks, publisher materials, or professor/institution slides unless you own the rights.";

export function attestationVersion(): string {
  return ATTESTATION_VERSION;
}
