import readme from "./README.md?raw";
import days0110 from "./daily_plans/days_01_10.md?raw";
import days1120 from "./daily_plans/days_11_20.md?raw";
import days2130 from "./daily_plans/days_21_30.md?raw";
import grammarComplete from "./grammar/grammar_complete.md?raw";
import kanjiAll from "./kanji/kanji_all_103.md?raw";
import vocabPart1 from "./vocab/vocab_part1.md?raw";
import vocabPart2 from "./vocab/vocab_part2.md?raw";
import vocabPart3 from "./vocab/vocab_part3.md?raw";

import { parseN5CoursePackage } from "../parser";

export const n5RawContent = {
  readme,
  dailyPlans: [days0110, days1120, days2130],
  grammar: grammarComplete,
  kanji: kanjiAll,
  vocabParts: [vocabPart1, vocabPart2, vocabPart3],
};

export const n5Course = parseN5CoursePackage(n5RawContent);
