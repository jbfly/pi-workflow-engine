import process from "node:process";
import { readdir } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { takeRegisteredTests, type RegisteredTest } from "./_harness.ts";

interface CliOptions {
  readonly list: boolean;
  readonly files: readonly string[];
}

interface TestWithFile extends RegisteredTest {
  readonly file: string;
}

const testsDir = fileURLToPath(new URL(".", import.meta.url));
const repoDir = fileURLToPath(new URL("..", import.meta.url));

function parseArgs(args: readonly string[]): CliOptions {
  const files: string[] = [];
  let list = false;
  for (const arg of args) {
    if (arg === "--list") {
      list = true;
      continue;
    }
    files.push(arg);
  }
  return { list, files };
}

async function discoverTestFiles(dir = testsDir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "fixtures") continue;
    if (entry.name.startsWith("_")) continue;

    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await discoverTestFiles(path)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(path);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function selectedFiles(options: CliOptions): Promise<string[]> {
  if (options.files.length === 0) return discoverTestFiles();
  return Promise.resolve(options.files.map((file) => resolve(process.cwd(), file)).sort((a, b) => a.localeCompare(b)));
}

function displayPath(path: string): string {
  return relative(repoDir, path) || basename(path);
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

async function loadTests(file: string): Promise<TestWithFile[]> {
  takeRegisteredTests();
  await import(pathToFileURL(file).href);
  return takeRegisteredTests().map((test) => ({ ...test, file }));
}

async function runTest(test: TestWithFile): Promise<boolean> {
  try {
    await test.fn();
    console.log(`✓ ${displayPath(test.file)} › ${test.name}`);
    return true;
  } catch (error) {
    console.error(`✗ ${displayPath(test.file)} › ${test.name}`);
    console.error(formatError(error));
    return false;
  }
}

export async function runCli(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  process.exitCode = 0;
  const options = parseArgs(args);
  const files = await selectedFiles(options);

  if (options.list) {
    console.log(`${files.length} test file(s)`);
    for (const file of files) console.log(displayPath(file));
    return;
  }

  let passed = 0;
  let failed = 0;

  for (const file of files) {
    let tests: TestWithFile[];
    try {
      tests = await loadTests(file);
    } catch (error) {
      failed++;
      console.error(`✗ ${displayPath(file)} › import`);
      console.error(formatError(error));
      continue;
    }

    for (const test of tests) {
      if (await runTest(test)) passed++;
      else failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
