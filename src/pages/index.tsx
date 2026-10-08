import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import mapRefImg from "@/imports/image-2.png";
import { useAppData } from "@/app/AppContext";
import { BEFORE_AFTER_ITEMS, CAMPAIGN_EVENTS, CLEANUP_LOCATIONS, DISTRICTS } from "@/app/data";
import { eventHasEnded, filterLocations, formatVietnameseDate } from "@/app/utils";
import ContactForm from "@/components/ContactForm";
import { DonationPanel, RegistrationForm, ReportForm } from "@/components/FeatureForms";

const statusStyle = { "Đang dọn dẹp": "bg-emerald-100 text-emerald-800", "Cần viện trợ": "bg-amber-100 text-amber-800", "Hoàn thành": "bg-blue-100 text-blue-800", "Sắp ra quân": "bg-purple-100 text-purple-800" };
const articles = [
  ["Hành trình 500 ngày hồi sinh sông Tô Lịch của người trẻ Thủ đô", "25/08/2026", "https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=600&auto=format&fit=crop"],
  ["Những chiến sĩ 'lội bùn' giữa lòng thành phố", "22/08/2026", "https://images.unsplash.com/photo-1618477461853-cf6ed80faba5?w=600&auto=format&fit=crop"],
  ["Bí quyết phân loại và tái chế rác thải nhựa", "18/08/2026", "https://images.unsplash.com/photo-1530587191325-3db32d826c18?w=600&auto=format&fit=crop"],
];
const impactTiers: [number, string][] = [[100000, "Một bộ đồ bảo hộ và găng tay"], [500000, "Dụng cụ thu gom cho một đội"], [2000000, "Xử lý rác cho một buổi quy mô lớn"]];

function Heading({ title, text, light = false }: { title: string; text?: string; light?: boolean }) { return <div className="mx-auto mb-12 max-w-3xl text-center"><h2 className={`text-3xl font-extrabold sm:text-4xl ${light ? "text-white" : "text-gray-900"}`}>{title}</h2>{text && <p className={`mt-3 text-lg ${light ? "text-emerald-200" : "text-gray-600"}`}>{text}</p>}</div>; }
function PageHero({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <section className="bg-emerald-950 px-4 pb-16 pt-32 text-center font-normal text-white" style={{ fontFamily: "Be Vietnam Pro, sans-serif" }}><span className="w-fit rounded-full bg-green-100 px-4 py-1.5 text-sm font-semibold text-green-800">{eyebrow}</span><h1 className="mx-auto mt-4 max-w-4xl text-4xl font-extrabold sm:text-5xl">{title}</h1><p className="mx-auto mt-4 max-w-2xl text-lg text-emerald-200">{text}</p></section>; }

function ActivityCards() {
  return <div className="grid gap-6 lg:grid-cols-3">{BEFORE_AFTER_ITEMS.map((card) => <article key={card.id} className="group overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white shadow-[0_12px_40px_rgba(15,56,44,0.07)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_50px_rgba(15,56,44,0.12)]"><div className="grid h-64 grid-cols-2 gap-0.5 overflow-hidden"><div className="relative overflow-hidden"><img src={card.beforeImg} alt={`Trước khi dọn ${card.location}`} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /><span className="absolute left-3 top-3 rounded-full bg-slate-950/75 px-3 py-1.5 text-[10px] font-extrabold tracking-[0.14em] text-white backdrop-blur">TRƯỚC</span></div><div className="relative overflow-hidden"><img src={card.afterImg} alt={`Sau khi dọn ${card.location}`} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /><span className="absolute right-3 top-3 rounded-full bg-emerald-600 px-3 py-1.5 text-[10px] font-extrabold tracking-[0.14em] text-white">SAU</span></div></div><div className="p-6"><p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-700">{card.date}</p><h3 className="mt-3 text-xl font-extrabold tracking-tight text-slate-900">{card.location}</h3><div className="mt-5 flex items-center justify-between gap-4 border-t border-slate-100 pt-5"><span className="text-sm font-semibold text-slate-500">{card.trash}</span><Link to={`/ban-do?location=${card.locationId}`} aria-label={`Xem ${card.location} trên bản đồ`} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-lg font-bold text-emerald-800 transition hover:bg-emerald-800 hover:text-white">→</Link></div></div></article>)}</div>;
}

export function CampaignPage() {
  const { registrations } = useAppData();
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);
  const visibleCampaigns = showAllCampaigns ? CAMPAIGN_EVENTS : CAMPAIGN_EVENTS.slice(0, 2);

  return <>
    <section className="relative isolate overflow-hidden bg-[#062d25] px-4 pb-24 pt-36 text-center text-white sm:pb-28 sm:pt-40">
      <div aria-hidden="true" className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_top_left,rgba(52,211,153,0.18),transparent_38%),radial-gradient(circle_at_85%_70%,rgba(132,204,22,0.12),transparent_32%)]" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:56px_56px]" />
      <div className="mx-auto max-w-6xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-4 py-2 text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-200">
          <span className="h-2 w-2 rounded-full bg-lime-300" />
          Chiến dịch Hà Nội Xanh
        </span>
        <h1 aria-label="Đừng chỉ nói, hãy hành động! Trực tiếp đồng hành cùng Hà Nội Xanh dọn sạch rác thải, kiến tạo thủ đô Xanh – Sạch – Đẹp. Chọn một chiến dịch và bắt đầu hành trình của bạn ngay hôm nay!" className="mx-auto mt-8 max-w-5xl text-4xl font-black leading-[1.12] tracking-[-0.035em] text-white sm:text-5xl lg:text-6xl">
          Đừng chỉ nói, hãy hành động!
          <span className="mt-3 block text-emerald-200">Trực tiếp đồng hành cùng Hà Nội Xanh dọn sạch rác thải, kiến tạo thủ đô Xanh – Sạch – Đẹp.</span>
          <span className="mt-3 block text-white">Chọn một chiến dịch và bắt đầu hành trình của bạn ngay hôm nay!</span>
        </h1>
        <a href="#lich-ra-quan" className="mt-10 inline-flex items-center justify-center gap-3 rounded-full bg-lime-300 px-7 py-4 text-sm font-extrabold text-emerald-950 shadow-[0_12px_32px_rgba(163,230,53,0.2)] transition hover:-translate-y-0.5 hover:bg-lime-200 focus:outline-none focus:ring-4 focus:ring-lime-300/30">
          Chọn chiến dịch
          <span aria-hidden="true">↓</span>
        </a>
      </div>
    </section>

    <section className="bg-[#f7faf8] py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 max-w-3xl">
          <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-700">Tác động nhìn thấy được</p>
          <h2 className="mt-4 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">Mỗi buổi ra quân.<br />Một thay đổi rõ ràng.</h2>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">Những điểm ô nhiễm được trả lại vẻ sạch đẹp bằng hành động bền bỉ của cộng đồng.</p>
        </div>
        <ActivityCards />
      </div>
    </section>

    <section id="lich-ra-quan" className="scroll-mt-20 bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 flex flex-col justify-between gap-6 border-b border-slate-200 pb-8 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-700">Tham gia cùng chúng tôi</p>
            <h2 className="mt-4 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">Lịch ra quân</h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-slate-500 sm:text-base">Chọn địa điểm phù hợp và đăng ký. Các chiến dịch đã qua sẽ tự động đóng đăng ký.</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">{visibleCampaigns.map((event) => {
          const ended = eventHasEnded(event);
          const saved = registrations.items.some((x) => x.eventId === event.id);
          return <article key={event.id} className="flex min-h-80 flex-col justify-between rounded-[1.75rem] border border-slate-200 bg-[#f8faf9] p-6 transition duration-300 hover:border-emerald-300 hover:bg-white hover:shadow-[0_16px_44px_rgba(15,56,44,0.08)] sm:p-8">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${ended ? "bg-slate-200 text-slate-600" : "bg-emerald-100 text-emerald-800"}`}>{ended ? "Đã kết thúc" : event.status}</span>
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{event.capacity} tình nguyện viên</span>
              </div>
              <h3 className="mt-8 text-2xl font-black leading-tight tracking-tight text-slate-950 sm:text-3xl">{event.title}</h3>
              <dl className="mt-7 grid gap-4 border-t border-slate-200 pt-6 text-sm sm:grid-cols-2">
                <div><dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Thời gian</dt><dd className="mt-1.5 font-bold text-slate-700">{formatVietnameseDate(event.date)}<br />{event.startTime}–{event.endTime}</dd></div>
                <div><dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Địa điểm</dt><dd className="mt-1.5 font-bold text-slate-700">{event.location}</dd></div>
              </dl>
            </div>
            {ended ? <span className="mt-8 rounded-full bg-slate-200 px-6 py-3.5 text-center text-sm font-extrabold text-slate-500">Sự kiện đã kết thúc</span> : <Link to={`/dang-ky/${event.id}`} className="mt-8 rounded-full bg-emerald-800 px-6 py-3.5 text-center text-sm font-extrabold text-white transition hover:bg-emerald-950">{saved ? "Xem đăng ký đã lưu" : "Đăng ký tham gia"}</Link>}
          </article>;
        })}</div>

        {CAMPAIGN_EVENTS.length > 2 && <div className="mt-10 text-center"><button type="button" onClick={() => setShowAllCampaigns((value) => !value)} className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-extrabold text-slate-700 transition hover:border-emerald-700 hover:text-emerald-800">{showAllCampaigns ? "Ẩn bớt chiến dịch ↑" : `Xem tất cả ${CAMPAIGN_EVENTS.length} chiến dịch →`}</button></div>}
      </div>
    </section>
  </>;
}

export function RegistrationPage() { const { eventId } = useParams(); const { registrations, notify } = useAppData(); const event = CAMPAIGN_EVENTS.find((x) => x.id === eventId); if (!event) return <NotFoundPage title="Không tìm thấy sự kiện" />; const ended = eventHasEnded(event); return <><PageHero eyebrow="Tình nguyện" title="Đăng ký tham gia" text="Thông tin được lưu trên trình duyệt cho tới khi hệ thống có máy chủ." /><section className="py-16"><div className="mx-auto max-w-4xl px-4"><Link to="/chien-dich" className="mb-5 inline-block font-bold text-emerald-700">← Quay lại danh sách</Link><div className="rounded-3xl bg-white p-8 shadow-lg md:p-12">{ended ? <div className="text-center"><h2 className="text-2xl font-black">Sự kiện đã kết thúc</h2><p className="mt-3 text-gray-600">Bạn có thể chọn một chiến dịch khác còn hiệu lực.</p><Link to="/chien-dich" className="mt-6 inline-block rounded-xl bg-emerald-700 px-6 py-3 font-bold text-white">Xem chiến dịch khác</Link></div> : <RegistrationForm event={event} registrations={registrations.items} warning={registrations.warning} onSave={(x) => { registrations.update((items) => [...items, x]); notify("Đã lưu đăng ký trên thiết bị."); }} onCancelRegistration={(id) => { registrations.update((items) => items.filter((x) => x.id !== id)); notify("Đã hủy đăng ký."); }} />}</div></div></section></>; }

export function MapPage() {
  const [params, setParams] = useSearchParams(); const query = params.get("q") ?? ""; const district = params.get("district") ?? "Tất cả"; const filtered = useMemo(() => filterLocations(CLEANUP_LOCATIONS, query, district), [query, district]);
  const requested = Number(params.get("location")); const selected = filtered.find((x) => x.id === requested) ?? filtered[0] ?? CLEANUP_LOCATIONS[0];
  const update = (key: string, value: string, replace = true) => { const next = new URLSearchParams(params); if (!value || value === "Tất cả") next.delete(key); else next.set(key, value); setParams(next, { replace }); };
  const event = CAMPAIGN_EVENTS.find((x) => x.id === selected.eventId); const canRegister = event && !eventHasEnded(event);
  return <><PageHero eyebrow="Bản đồ" title="Tuyến sông & điểm nóng Hà Nội Xanh" text="Tìm kiếm, lọc và chia sẻ trực tiếp địa điểm qua URL." /><section className="bg-gray-50 py-16"><div className="mx-auto max-w-7xl px-4"><div className="mb-6 flex flex-col gap-3 sm:flex-row"><label><span className="sr-only">Tìm địa điểm</span><input value={query} onChange={(e) => update("q", e.target.value)} placeholder="Tìm khu vực hoặc tên sông…" className="w-full rounded-lg border px-4 py-2 sm:w-72" /></label><label><span className="sr-only">Lọc theo quận</span><select value={district} onChange={(e) => update("district", e.target.value)} className="w-full rounded-lg border px-4 py-2">{DISTRICTS.map((x) => <option key={x}>{x}</option>)}</select></label></div><div className="grid overflow-hidden rounded-2xl border bg-white shadow-xl lg:grid-cols-12"><div className="max-h-[600px] space-y-3 overflow-y-auto bg-gray-50 p-5 lg:col-span-5"><p className="text-xs font-bold uppercase text-gray-500">{filtered.length} địa điểm phù hợp</p>{!filtered.length && <div className="rounded-xl border border-dashed bg-white p-8 text-center"><b>Không tìm thấy địa điểm</b><button type="button" onClick={() => setParams({})} className="mt-3 block w-full font-bold text-emerald-700 underline">Xóa bộ lọc</button></div>}{filtered.map((loc) => <button type="button" key={loc.id} onClick={() => update("location", String(loc.id), false)} className={`w-full rounded-xl border p-4 text-left ${selected.id === loc.id ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200" : "bg-white"}`}><div className="flex justify-between gap-2"><strong>{loc.title}</strong><span className={`h-fit shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${statusStyle[loc.status]}`}>{loc.status}</span></div><p className="mt-2 text-xs text-gray-500">Quận {loc.district}</p></button>)}</div><div className="relative flex min-h-[540px] flex-col justify-end overflow-hidden bg-emerald-950 lg:col-span-7"><img src={mapRefImg} alt="Bản đồ nền Hà Nội" className="absolute inset-0 h-full w-full object-cover opacity-25" /><div className="absolute inset-x-0 top-0 h-[390px]">{filtered.map((loc) => <button type="button" aria-label={`Chọn ${loc.title}`} key={loc.id} onClick={() => update("location", String(loc.id), false)} style={{ top: loc.coords.top, left: loc.coords.left }} className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white px-3 py-2 text-xs font-black text-white ${selected.id === loc.id ? "scale-125 bg-orange-500" : "bg-emerald-600"}`}>{loc.id}</button>)}</div><div className="relative z-10 m-4 rounded-2xl bg-white p-5"><h2 className="font-extrabold">{selected.title}</h2><p className="mt-1 text-sm text-gray-600">{selected.district} · Trưởng nhóm {selected.coordinator}</p>{canRegister ? <Link to={`/dang-ky/${event.id}`} className="mt-4 block rounded-xl bg-emerald-600 py-3 text-center font-bold text-white">Đăng ký hoạt động tại đây</Link> : <p className="mt-4 rounded-xl bg-gray-100 p-3 text-center text-sm font-bold text-gray-600">Chưa có lịch đăng ký còn hiệu lực</p>}</div></div></div></div></section></>;
}

export function ImpactPage() { return <><PageHero eyebrow="Tác động" title="Mỗi đóng góp đều làm thay đổi dòng sông" text="Minh họa cách từng mức hỗ trợ được dùng cho hoạt động cộng đồng." /><section className="bg-white py-20"><div className="mx-auto grid max-w-7xl gap-8 px-4 md:grid-cols-3">{impactTiers.map(([amount, text]) => <article key={amount} className="rounded-2xl border bg-gray-50 p-8"><h2 className="text-2xl font-black text-emerald-800">{amount.toLocaleString("vi-VN")} VNĐ</h2><p className="mt-3 text-gray-600">{text}</p><Link to={`/ung-ho?amount=${amount}`} className="mt-6 block rounded-xl bg-emerald-800 py-3 text-center font-bold text-white">Xem cách ủng hộ</Link></article>)}</div></section></>; }
export function DonatePage() { const [params] = useSearchParams(); const parsed = Number(params.get("amount")); const amount = [50000, 100000, 500000, 2000000].includes(parsed) ? parsed : 100000; const { notify } = useAppData(); return <><PageHero eyebrow="Ủng hộ" title="Đồng hành cùng Hà Nội Xanh" text="Website chỉ cung cấp hướng dẫn, không xử lý hoặc xác nhận thanh toán." /><section className="py-16"><div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-lg md:p-12"><DonationPanel key={amount} initialAmount={amount} onNotice={notify} /></div></section></>; }
export function ReportPage() { const { reports, notify } = useAppData(); return <><PageHero eyebrow="Cộng đồng" title="Báo điểm ô nhiễm" text="Ghi lại vị trí và tình trạng để chuẩn bị kết nối ban điều hành trong giai đoạn API." /><section className="py-16"><div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-lg md:p-12"><ReportForm reports={reports.items} warning={reports.warning} onSave={(x) => { reports.update((items) => [...items, x]); notify("Đã lưu báo cáo trên thiết bị."); }} /></div></section></>; }
export function ContactPage() { const { messages } = useAppData(); return <><PageHero eyebrow="Liên hệ" title="Để lại lời nhắn" text="Lời nhắn được lưu trên thiết bị cho tới khi website có máy chủ." /><section className="py-16"><div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-lg md:p-12"><ContactForm warning={messages.warning} onSave={(x) => messages.update((items) => [...items, x])} /></div></section></>; }
export function NewsPage() { return <><PageHero eyebrow="Tin tức" title="Tin tức và câu chuyện" text="Nội dung chi tiết đang được đội ngũ biên tập hoàn thiện." /><section className="bg-gray-50 py-20"><div className="mx-auto grid max-w-7xl gap-8 px-4 md:grid-cols-3">{articles.map(([title, date, img]) => <article key={title} className="overflow-hidden rounded-2xl border bg-white"><img src={img} alt="" className="h-48 w-full object-cover" /><div className="p-6"><small className="font-bold text-emerald-700">{date}</small><h2 className="mt-2 text-lg font-bold">{title}</h2><span aria-disabled="true" className="mt-4 inline-block text-sm font-bold text-gray-400">Nội dung đang cập nhật</span></div></article>)}</div></section></>; }
export function NotFoundPage({ title = "Không tìm thấy trang" }: { title?: string }) { return <section className="flex min-h-[70vh] items-center justify-center px-4 pt-24 text-center"><div><p className="text-7xl font-black text-emerald-200">404</p><h1 className="mt-4 text-3xl font-black">{title}</h1><p className="mt-3 text-gray-600">Đường dẫn không tồn tại hoặc nội dung đã được di chuyển.</p><Link to="/" className="mt-6 inline-block rounded-xl bg-emerald-700 px-6 py-3 font-bold text-white">Về trang chủ</Link></div></section>; }
