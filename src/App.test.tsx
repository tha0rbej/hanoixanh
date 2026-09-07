import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";

describe("application routes", () => {
  beforeEach(() => { localStorage.clear(); window.history.replaceState({}, "", "/"); });

  it("navigates from the home CTA to a separate map page", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("link", { name: "Xem bản đồ hoạt động" }));
    expect(await screen.findByRole("heading", { name: "Tuyến sông & điểm nóng Hà Nội Xanh" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/ban-do");
  });

  it("renders a route directly and keeps map selection in the URL", async () => {
    window.history.replaceState({}, "", "/ban-do?location=5");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sông Kim Ngưu - Thanh Nhàn" })).toBeInTheDocument();
    expect(window.location.search).toBe("?location=5");
  });

  it("redirects a legacy section hash to its new route", async () => {
    window.history.replaceState({}, "", "/#ban-do-hoat-dong");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/ban-do"));
  });

  it("supports browser back navigation", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("link", { name: "Về Hà Nội Xanh →" }));
    expect(window.location.pathname).toBe("/ve-ha-noi-xanh");
    act(() => { window.history.back(); window.dispatchEvent(new PopStateEvent("popstate")); });
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });

  it("shows a useful 404 page", async () => {
    window.history.replaceState({}, "", "/khong-ton-tai");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Không tìm thấy trang" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Về trang chủ" })).toHaveAttribute("href", "/");
  });

  it.each([
    ["/ve-ha-noi-xanh", "Chung tay vì một Việt Nam xanh – sạch – đẹp"],
    ["/chien-dich", "Hoạt động và lịch ra quân"],
    ["/tac-dong", "Mỗi đóng góp đều làm thay đổi dòng sông"],
    ["/ung-ho?amount=500000", "Đồng hành cùng Hà Nội Xanh"],
    ["/bao-o-nhiem", "Báo điểm ô nhiễm"],
    ["/lien-he", "Để lại lời nhắn"],
    ["/tin-tuc", "Tin tức và câu chuyện"],
  ])("renders %s directly", async (path, heading) => {
    window.history.replaceState({}, "", path);
    render(<App />);
    expect(await screen.findByRole("heading", { name: heading, level: 1 })).toBeInTheDocument();
  });

  it("keeps the old introduction URL working and uses the new name", async () => {
    window.history.replaceState({}, "", "/gioi-thieu");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/ve-ha-noi-xanh"));
    expect(screen.getAllByRole("link", { name: "Về Hà Nội Xanh" }).length).toBeGreaterThan(0);
    expect(screen.getByText(/thành lập vào tháng 12\/2022/i)).toBeInTheDocument();
  });
});
