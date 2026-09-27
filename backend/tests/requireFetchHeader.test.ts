import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "../src/errors/AppError.js";
import { requireFetchHeader } from "../src/middleware/requireFetchHeader.js";

function fakeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

describe("requireFetchHeader middleware", () => {
  it("calls next() when X-Requested-With: XMLHttpRequest is present", () => {
    const req = fakeReq({ "x-requested-with": "XMLHttpRequest" });
    const next = vi.fn();

    requireFetchHeader(req, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it("throws ForbiddenError when the header is missing", () => {
    const req = fakeReq();
    const next = vi.fn();

    expect(() => requireFetchHeader(req, {} as Response, next)).toThrow(ForbiddenError);
    expect(next).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError when the header has a different value", () => {
    const req = fakeReq({ "x-requested-with": "some-other-value" });
    const next = vi.fn();

    expect(() => requireFetchHeader(req, {} as Response, next)).toThrow(ForbiddenError);
  });
});
