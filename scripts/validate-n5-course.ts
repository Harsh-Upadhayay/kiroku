import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseN5CoursePackage } from "../src/content/n5/parser";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const course = parseN5CoursePackage({
  readme: read("src/content/n5/raw/README.md"),
  dailyPlans: [
    read("src/content/n5/raw/daily_plans/days_01_10.md"),
    read("src/content/n5/raw/daily_plans/days_11_20.md"),
    read("src/content/n5/raw/daily_plans/days_21_30.md"),
  ],
  grammar: read("src/content/n5/raw/grammar/grammar_complete.md"),
  kanji: read("src/content/n5/raw/kanji/kanji_all_103.md"),
  vocabParts: [
    read("src/content/n5/raw/vocab/vocab_part1.md"),
    read("src/content/n5/raw/vocab/vocab_part2.md"),
    read("src/content/n5/raw/vocab/vocab_part3.md"),
  ],
});

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

assert(course.days.length === 30, `Expected 30 days, got ${course.days.length}`);
assert(Object.keys(course.grammar).length === 60, `Expected 60 grammar points, got ${Object.keys(course.grammar).length}`);
assert(Object.keys(course.vocab).length === 800, `Expected 800 vocab entries, got ${Object.keys(course.vocab).length}`);
assert(course.kanjiList.length === 103, `Expected 103 kanji entries, got ${course.kanjiList.length}`);
assert(course.checkpoints.length === 4, `Expected 4 checkpoints, got ${course.checkpoints.length}`);

course.days.forEach((day) => {
  day.grammarIds.forEach((id) => assert(course.grammar[id], `Day ${day.day} references missing grammar ${id}`));
  const allowedMissingKanji = day.day === 12 ? new Set(["雪", "風"]) : new Set<string>();
  day.kanjiChars.forEach((char) => assert(course.kanji[char] || allowedMissingKanji.has(char), `Day ${day.day} references missing kanji ${char}`));
  day.unresolvedKanjiChars.forEach((char) => assert(allowedMissingKanji.has(char), `Unexpected unresolved kanji ${char} on Day ${day.day}`));
  day.vocabRanges.forEach((range) => {
    for (let num = range.start; num <= range.end; num += 1) {
      const id = String(num).padStart(3, "0");
      assert(course.vocab[id], `Day ${day.day} references missing vocab ${id}`);
    }
  });
});

const uniqueDay22 = new Set(course.days.find((day) => day.day === 22)?.vocab.map((entry) => entry.id));
assert(uniqueDay22.size === course.days.find((day) => day.day === 22)?.vocab.length, "Review ranges should not duplicate learned vocab IDs");
assert(course.days.find((day) => day.day === 27)?.vocab.length === 100, "Day 27 should expose late vocab intake range 601-700");
assert(course.days.find((day) => day.day === 28)?.vocab.length === 100, "Day 28 should expose late vocab intake range 701-800");
const aliasEntry = course.kanjiList.find((entry) => entry.index === 92);
assert(aliasEntry?.aliasOf === "69", "Kanji alias entry #92 should point to #69");
assert(aliasEntry?.mnemonic === course.kanji["話"]?.mnemonic, "Kanji alias should preserve resolved fields");

console.log(`N5 course validated: ${course.days.length} days, ${Object.keys(course.vocab).length} vocab, ${course.kanjiList.length} kanji, ${Object.keys(course.grammar).length} grammar.`);
