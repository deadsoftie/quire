import { ExternalTokenizer } from "@lezer/lr";
import { VerbatimBody } from "./parser.terms";

const END_ENV = "\\end{";

// Scans raw (unparsed) verbatim content up to the next literal "\end{",
// without consuming it. `fallback: true` is required here: the regular
// (non-external) tokenizer will happily produce ordinary Command/Text
// tokens for whatever's inside a verbatim block, and those aren't valid
// wherever VerbatimBody is expected -- fallback lets this tokenizer run
// anyway instead of the parser just erroring on the first one.
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
