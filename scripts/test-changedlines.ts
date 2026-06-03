// Pure-function check for the diff line-gate (no LLM). Run: `bun scripts/test-changedlines.ts`
import { changedLines, inDiff } from "../workflows/code-review.ts";

let failures = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failures++;
    console.error(`FAIL ${name}: got ${g} want ${w}`);
  } else {
    console.log(`ok   ${name}`);
  }
}
const lines = (m: Map<string, Set<number>>, f: string): number[] => [...(m.get(f) ?? [])].sort((a, b) => a - b);

const d1 = `diff --git a/sum.js b/sum.js
index e0f74bf..54295d7 100644
--- a/sum.js
+++ b/sum.js
@@ -1,6 +1,6 @@
 function sum(arr) {
   let total = 0;
-  for (let i = 0; i < arr.length; i++) total += arr[i];
+  for (let i = 0; i <= arr.length; i++) total += arr[i];
   return total;
 }
 module.exports = { sum };
`;
const c1 = changedLines(d1);
eq("single-hunk added line", lines(c1, "sum.js"), [3]);
eq("inDiff exact hit", inDiff(c1, "sum.js", 3), true);
eq("inDiff fuzz + path prefix", inDiff(c1, "b/sum.js", 4), true); // 4±1 includes 3
eq("inDiff out-of-diff line", inDiff(c1, "sum.js", 7), false);
eq("inDiff unknown file", inDiff(c1, "other.js", 3), false);
eq("inDiff file-level on changed file", inDiff(c1, "sum.js"), true);

const d2 = `diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -10,3 +10,4 @@ function f() {
 const x = 1;
+const y = 2;
 const z = 3;
 return x;
@@ -40,2 +41,2 @@ function g() {
-  old();
+  new();
   keep();
diff --git a/b.ts b/b.ts
new file mode 100644
index 000..333
--- /dev/null
+++ b/b.ts
@@ -0,0 +1,2 @@
+export const A = 1;
+export const B = 2;
`;
const c2 = changedLines(d2);
eq("multi-hunk new-line numbers", lines(c2, "a.ts"), [11, 41]);
eq("added new file", lines(c2, "b.ts"), [1, 2]);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
