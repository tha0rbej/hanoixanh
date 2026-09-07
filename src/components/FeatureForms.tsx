import { useState, type FormEvent } from "react";
import type { CampaignEvent, PollutionReport, VolunteerRegistration } from "@/app/types";
import { createId, formatVietnameseDate, isDuplicateRegistration, isValidVietnamesePhone } from "@/app/utils";

const inputClass = "mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200";

export function RegistrationForm({ event, registrations, warning, onSave, onCancelRegistration }: { event: CampaignEvent; registrations: VolunteerRegistration[]; warning: string; onSave: (value: VolunteerRegistration) => void; onCancelRegistration: (id: string) => void }) {
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", note: "" });
  const [error, setError] = useState("");
  const existing = registrations.filter((item) => item.eventId === event.id);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim() || !form.email.trim() || !isValidVietnamesePhone(form.phone)) return setError("Vui lòng nhập đủ thông tin và kiểm tra lại số điện thoại Việt Nam.");
    if (isDuplicateRegistration(registrations, event.id, form.email, form.phone)) return setError("Email hoặc số điện thoại này đã đăng ký sự kiện.");
    onSave({ id: createId(), eventId: event.id, fullName: form.fullName.trim(), phone: form.phone.trim(), email: form.email.trim(), note: form.note.trim(), createdAt: new Date().toISOString() });
    setForm({ fullName: "", phone: "", email: "", note: "" }); setError("");
  };
  return <>
    <div className="mb-5 rounded-xl bg-emerald-50 p-4 text-sm"><strong className="block text-emerald-900">{event.title}</strong><span>{formatVietnameseDate(event.date)}, {event.startTime}–{event.endTime}</span><span className="block">{event.location}</span></div>
    <p className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Bản MVP chỉ lưu đăng ký trên thiết bị này, chưa gửi tới ban tổ chức.</p>
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-bold">Họ và tên *<input className={inputClass} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></label>
      <label className="text-sm font-bold">Số điện thoại *<input className={inputClass} inputMode="tel" placeholder="0912 345 678" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></label>
      <label className="text-sm font-bold sm:col-span-2">Email *<input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
      <label className="text-sm font-bold sm:col-span-2">Ghi chú<textarea className={inputClass} rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
      {(error || warning) && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error || warning}</p>}
      <button className="rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white sm:col-span-2">Lưu đăng ký trên thiết bị</button>
    </form>
    {existing.length > 0 && <div className="mt-6 border-t pt-4"><h2 className="font-bold">Đăng ký đã lưu</h2>{existing.map((item) => <div key={item.id} className="mt-2 flex items-center justify-between rounded-lg bg-gray-50 p-3 text-sm"><span><strong>{item.fullName}</strong><br />{item.email}</span><button type="button" onClick={() => onCancelRegistration(item.id)} className="font-bold text-red-700 hover:underline">Hủy</button></div>)}</div>}
  </>;
}

export function ReportForm({ reports, warning, onSave }: { reports: PollutionReport[]; warning: string; onSave: (value: PollutionReport) => void }) {
  const [form, setForm] = useState({ address: "", description: "", latitude: undefined as number | undefined, longitude: undefined as number | undefined });
  const [geoStatus, setGeoStatus] = useState("");
  const locate = () => {
    if (!navigator.geolocation) return setGeoStatus("Trình duyệt không hỗ trợ GPS. Bạn vẫn có thể nhập địa chỉ.");
    setGeoStatus("Đang lấy vị trí…");
    navigator.geolocation.getCurrentPosition(({ coords }) => { setForm((current) => ({ ...current, latitude: coords.latitude, longitude: coords.longitude })); setGeoStatus("Đã lấy tọa độ hiện tại."); }, () => setGeoStatus("Không lấy được GPS. Vui lòng nhập địa chỉ thủ công."), { timeout: 10000, enableHighAccuracy: true });
  };
  const submit = (e: FormEvent) => { e.preventDefault(); onSave({ id: createId(), address: form.address.trim(), description: form.description.trim(), latitude: form.latitude, longitude: form.longitude, createdAt: new Date().toISOString() }); setForm({ address: "", description: "", latitude: undefined, longitude: undefined }); setGeoStatus(""); };
  return <><p className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Báo cáo chỉ được lưu trên thiết bị này và chưa gửi tới ban điều hành.</p><form onSubmit={submit} className="space-y-4">
    <label className="block text-sm font-bold">Địa chỉ hoặc mô tả vị trí *<input className={inputClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required /></label>
    <div><button type="button" onClick={locate} className="rounded-lg border border-emerald-600 px-4 py-2 text-sm font-bold text-emerald-800">Lấy GPS hiện tại</button>{geoStatus && <p role="status" className="mt-2 text-xs text-gray-600">{geoStatus}</p>}</div>
    <label className="block text-sm font-bold">Mô tả tình trạng *<textarea className={inputClass} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required minLength={10} /></label>{warning && <p role="alert" className="text-sm text-red-700">{warning}</p>}<button className="w-full rounded-xl bg-orange-500 px-5 py-3 font-bold text-white">Lưu báo cáo trên thiết bị</button>
  </form>{reports.length > 0 && <div className="mt-6 border-t pt-4"><h2 className="font-bold">Báo cáo gần đây ({reports.length})</h2>{reports.slice(-3).reverse().map((report) => <div key={report.id} className="mt-2 rounded-lg bg-gray-50 p-3 text-sm"><strong>{report.address}</strong><p className="text-gray-600">{report.description}</p></div>)}</div>}</>;
}

export function DonationPanel({ initialAmount, onNotice }: { initialAmount: number; onNotice: (message: string) => void }) {
  const [amount, setAmount] = useState(initialAmount || 100000);
  const copy = async (value: string, label: string) => { try { await navigator.clipboard.writeText(value); onNotice(`Đã sao chép ${label}.`); } catch { onNotice(`Không thể tự sao chép. Hãy chọn thủ công: ${value}`); } };
  return <><p className="mb-4 text-sm text-gray-600">Chọn mức ủng hộ rồi chuyển khoản trực tiếp. Website không xử lý hoặc xác nhận thanh toán.</p><div className="mb-5 grid grid-cols-2 gap-2">{[50000, 100000, 500000, 2000000].map((value) => <button type="button" key={value} onClick={() => setAmount(value)} className={`rounded-xl border-2 p-3 font-bold ${amount === value ? "border-orange-500 bg-orange-50 text-orange-800" : "border-gray-200"}`}>{value.toLocaleString("vi-VN")}đ</button>)}</div><div className="space-y-3 rounded-xl bg-gray-50 p-4 text-sm"><p>Ngân hàng: <strong>MB Bank</strong></p><p>Số tài khoản: <strong>8888 6666 9999</strong> <button type="button" onClick={() => copy("888866669999", "số tài khoản")} className="ml-2 text-emerald-700 underline">Sao chép</button></p><p>Chủ tài khoản: <strong>QUY HA NOI XANH</strong></p><p>Nội dung: <strong>HNX UNG HO {amount}</strong> <button type="button" onClick={() => copy(`HNX UNG HO ${amount}`, "nội dung chuyển khoản")} className="ml-2 text-emerald-700 underline">Sao chép</button></p></div></>;
}
