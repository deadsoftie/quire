import { ExternalTokenizer } from "@lezer/lr";
import { VerbatimBody } from "./parser.terms";

const END_ENV = "\\end{";

// `fallback: true` is required: without it, the regular tokenizer's Command/Text tokens (invalid here) would win before this ever runs.
export const verbatimTokenizer = new ExternalTokenizer(
  (input) => {
    if (input.next < 0) return;
    let offset = 0;
    for (;;) {
      if (input.peek(offset) < 0) {
        input.acceptToken(VerbatimBody, offset);
        return;
      }
      let matched = true;
      for (let i = 0; i < END_ENV.length; i++) {
        if (input.peek(offset + i) !== END_ENV.charCodeAt(i)) {
          matched = false;
          break;
        }
      }
      if (matched) {
        if (offset > 0) input.acceptToken(VerbatimBody, offset);
        return;
      }
      offset++;
    }
  },
  { fallback: true },
);
