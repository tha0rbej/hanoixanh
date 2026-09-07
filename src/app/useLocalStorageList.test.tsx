import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useLocalStorageList } from "./useLocalStorageList";

describe("useLocalStorageList", () => {
  beforeEach(() => localStorage.clear());

  it("persists updates and restores them on the next render", () => {
    const first = renderHook(() => useLocalStorageList<{ id: string }>("test:list"));
    act(() => first.result.current.update((items) => [...items, { id: "saved" }]));
    expect(JSON.parse(localStorage.getItem("test:list") ?? "[]")).toEqual([{ id: "saved" }]);
    first.unmount();
    const second = renderHook(() => useLocalStorageList<{ id: string }>("test:list"));
    expect(second.result.current.items).toEqual([{ id: "saved" }]);
  });

  it("recovers from malformed stored data", () => {
    localStorage.setItem("test:list", "not-json");
    const { result } = renderHook(() => useLocalStorageList("test:list"));
    expect(result.current.items).toEqual([]);
    expect(result.current.warning).toContain("Không thể đọc");
  });
});
