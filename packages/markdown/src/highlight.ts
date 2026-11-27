import type { ElementContent } from "hast";
import bash from "highlight.js/lib/languages/bash";
import http from "highlight.js/lib/languages/http";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";

/** The code of a block as coloured spans, or null for a language it does not know. */
export type Highlighter = (language: string, code: string) => ElementContent[] | null;

/**
 * The languages the corpus fences its code in, and no others. A block in any
 * other language, or in none, stays plain rather than guessed at.
 */
const lowlight = createLowlight({ bash, http, javascript, json, kotlin, python, typescript, yaml });
lowlight.registerAlias({
  bash: ["sh", "shell"],
  javascript: ["js"],
  json: ["jsonc"],
  typescript: ["ts"],
});

/**
 * Handed to `renderMarkdown` rather than built into it: the grammars weigh about
 * as much as the rest of a page's script, and a bundle that never names this
 * export never carries them. The server colours the page it sends.
 */
export const highlighter: Highlighter = (language, code) =>
  lowlight.registered(language)
    ? (lowlight.highlight(language, code).children as ElementContent[])
    : null;
