import { useState, type FormEvent } from "react";
import type { ContactMessage } from "@/app/types";
import { createId } from "@/app/utils";

export default function ContactForm({ warning, onSave }: { warning: string; onSave: (message: ContactMessage) => void }) {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [saved, setSaved] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ id: createId(), name: form.name.trim(), email: form.email.trim(), message: form.message.trim(), createdAt: new Date().toISOString() });
    setForm({ name: "", email: "", message: "" }); setSaved(true);
  };
  if (saved) return <div role="status" className="py-10 text-center"><div className="text-5xl text-emerald-600">✓</div><h3 className="mt-3 text-2xl font-black">Đã lưu lời nhắn</h3><p className="mx-auto mt-2 max-w-md text-sm text-gray-600">Lời nhắn mới chỉ nằm trên thiết bị này, chưa được gửi tới Hà Nội Xanh.</p><button type="button" onClick={() => setSaved(false)} className="mt-5 font-bold text-emerald-700 underline">Viết lời nhắn khác</button></div>;
  const inputClass = "w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500";
  return <form onSubmit={submit} className="space-y-4">
    <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">MVP chưa có máy chủ. Lời nhắn sẽ chỉ được lưu trong trình duyệt này.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-xs font-bold uppercase">Họ và tên *<input className={inputClass} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label className="text-xs font-bold uppercase">Email *<input className={inputClass} required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
    </div>
    <label className="block text-xs font-bold uppercase">Lời nhắn *<textarea className={inputClass} required minLength={10} rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
    {warning && <p role="alert" className="text-sm text-red-700">{warning}</p>}
    <button className="w-full rounded-xl bg-emerald-600 py-3 font-extrabold text-white hover:bg-emerald-500">Lưu lời nhắn trên thiết bị</button>
  </form>;
}
