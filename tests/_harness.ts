import assert from "node:assert/strict";

export { assert };

export type MaybePromise<T> = T | Promise<T>;
export type TestFunction = () => MaybePromise<void>;

export interface RegisteredTest {
  readonly name: string;
  readonly fn: TestFunction;
}

const registeredTests: RegisteredTest[] = [];

export function test(name: string, fn: TestFunction): void {
  registeredTests.push({ name, fn });
}

export function takeRegisteredTests(): RegisteredTest[] {
  const tests = [...registeredTests];
  registeredTests.length = 0;
  return tests;
}
