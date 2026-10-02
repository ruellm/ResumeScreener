import { randomInt } from "node:crypto";

// No lookalike characters (0/o, 1/l/i).
const ALIAS_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const ALIAS_LENGTH = 8;

export function generateEmailAlias() {
  let alias = "";
  for (let i = 0; i < ALIAS_LENGTH; i++) {
    alias += ALIAS_ALPHABET[randomInt(ALIAS_ALPHABET.length)];
  }
  return alias;
}
