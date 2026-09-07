import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Dialog from "./Dialog";

describe("Dialog", () => {
  it("closes with Escape and exposes dialog semantics", async () => {
    const close = vi.fn();
    render(<Dialog open title="Kiểm tra" onClose={close}><button>Nút trong dialog</button></Dialog>);
    expect(screen.getByRole("dialog", { name: "Kiểm tra" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps tab focus inside the dialog", async () => {
    render(<Dialog open title="Focus" onClose={() => {}}><button>Đầu</button><button>Cuối</button></Dialog>);
    const first = screen.getByRole("button", { name: "Đóng cửa sổ" });
    const last = screen.getByRole("button", { name: "Cuối" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
  });
});
