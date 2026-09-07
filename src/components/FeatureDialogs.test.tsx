import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CAMPAIGN_EVENTS } from "@/app/data";
import type { PollutionReport, VolunteerRegistration } from "@/app/types";
import { DonationDialog, RegistrationDialog, ReportDialog } from "./FeatureDialogs";

describe("feature dialogs", () => {
  it("validates and saves a volunteer registration", async () => {
    const save = vi.fn();
    render(<RegistrationDialog event={CAMPAIGN_EVENTS[2]} registrations={[]} warning="" onSave={save} onCancelRegistration={() => {}} onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText(/Họ và tên/), "Nguyễn Văn An");
    await userEvent.type(screen.getByLabelText(/Số điện thoại/), "0912345678");
    await userEvent.type(screen.getByLabelText(/Email/), "an@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Lưu đăng ký trên thiết bị" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ eventId: CAMPAIGN_EVENTS[2].id, email: "an@example.com" }));
  });

  it("blocks a duplicate registration", async () => {
    const existing = [{ id: "1", eventId: CAMPAIGN_EVENTS[2].id, fullName: "A", phone: "0912345678", email: "a@example.com", note: "", createdAt: "" }] as VolunteerRegistration[];
    const save = vi.fn();
    render(<RegistrationDialog event={CAMPAIGN_EVENTS[2]} registrations={existing} warning="" onSave={save} onCancelRegistration={() => {}} onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText(/Họ và tên/), "Nguyễn Văn B");
    await userEvent.type(screen.getByLabelText(/Số điện thoại/), "0999999999");
    await userEvent.type(screen.getByLabelText(/Email/), "A@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Lưu đăng ký trên thiết bị" }));
    expect(screen.getByRole("alert")).toHaveTextContent("đã đăng ký");
    expect(save).not.toHaveBeenCalled();
  });

  it("falls back to manual address when GPS fails", async () => {
    const getCurrentPosition = vi.fn((_success, error) => error(new Error("denied")));
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
    render(<ReportDialog open reports={[] as PollutionReport[]} warning="" onSave={() => {}} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Lấy GPS hiện tại" }));
    expect(await screen.findByText(/nhập địa chỉ thủ công/)).toBeInTheDocument();
  });

  it("reports a clipboard failure with a manual fallback", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) } });
    const notice = vi.fn();
    render(<DonationDialog open initialAmount={100000} onClose={() => {}} onNotice={notice} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Sao chép" })[0]);
    expect(notice).toHaveBeenCalledWith(expect.stringContaining("chọn thủ công"));
  });
});
