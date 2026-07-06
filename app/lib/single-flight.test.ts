import { describe, expect, it } from "vitest";
import { SingleFlight } from "./single-flight";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SingleFlight", () => {
  it("shares an in-flight async operation with concurrent callers", async () => {
    const flight = new SingleFlight<boolean>();
    const pending = deferred<boolean>();
    let calls = 0;

    const first = flight.run(() => {
      calls += 1;
      return pending.promise;
    });
    const second = flight.run(() => {
      calls += 1;
      return Promise.resolve(false);
    });

    pending.resolve(true);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(calls).toBe(1);
  });

  it("allows a new operation after the previous one settles", async () => {
    const flight = new SingleFlight<number>();
    await expect(flight.run(() => Promise.resolve(1))).resolves.toBe(1);
    await expect(flight.run(() => Promise.resolve(2))).resolves.toBe(2);
  });

  it("clears the in-flight operation after rejection", async () => {
    const flight = new SingleFlight<number>();
    await expect(flight.run(() => Promise.reject(new Error("nope")))).rejects.toThrow("nope");
    await expect(flight.run(() => Promise.resolve(3))).resolves.toBe(3);
  });
});
