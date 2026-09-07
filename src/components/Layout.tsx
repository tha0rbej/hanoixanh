import { useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import logoImg from "@/imports/image-1.png";
import { useAppData } from "@/app/AppContext";
import Header from "./Header";

const legacy: Record<string, string> = { "#trang-chu": "/", "#ve-ha-noi-xanh": "/ve-ha-noi-xanh", "#hoat-dong-noi-bat": "/chien-dich", "#lich-ra-quan": "/chien-dich", "#ban-do-hoat-dong": "/ban-do", "#tac-dong": "/tac-dong", "#tin-tuc": "/tin-tuc" };

export default function Layout() {
  const location = useLocation(); const navigate = useNavigate(); const { reports } = useAppData();
  useEffect(() => { const target = legacy[location.hash]; if (target) navigate(target, { replace: true }); else window.scrollTo({ top: 0, behavior: "auto" }); }, [location.pathname, location.hash, navigate]);
  return <div className="min-h-screen overflow-x-hidden bg-[#f8faf9] text-gray-900 antialiased"><Header /><main><Outlet /></main><footer className="bg-emerald-950 text-white"><div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-4"><div><div className="flex items-center gap-3"><img src={logoImg} alt="" className="h-10 w-10 rounded-full bg-white" /><strong>HÀ NỘI <span className="text-emerald-400">XANH</span></strong></div><p className="mt-3 text-sm text-emerald-200">Tổ chức bảo vệ môi trường, chung tay vì một Việt Nam xanh – sạch – đẹp.</p></div><div><h2 className="font-bold text-emerald-400">Khám phá</h2><Link className="mt-3 block text-sm" to="/ve-ha-noi-xanh">Về Hà Nội Xanh</Link><Link className="mt-2 block text-sm" to="/chien-dich">Chiến dịch</Link><Link className="mt-2 block text-sm" to="/ban-do">Bản đồ</Link></div><div><h2 className="font-bold text-emerald-400">Liên hệ</h2><Link className="mt-3 block text-sm" to="/lien-he">Gửi lời nhắn</Link><a className="mt-2 block text-sm" href="tel:+84987231832">+84 98 723 18 32</a><a className="mt-2 block text-sm" href="mailto:hanoixanhh@gmail.com">hanoixanhh@gmail.com</a><p className="mt-2 text-sm">117 Xuân Thủy, phường Cầu Giấy, Hà Nội</p></div><div><h2 className="font-bold text-orange-400">Phát hiện ô nhiễm?</h2><Link to="/bao-o-nhiem" className="mt-4 inline-block rounded-lg bg-orange-500 px-5 py-3 text-sm font-bold">Báo điểm ô nhiễm ({reports.items.length})</Link></div></div><p className="border-t border-emerald-900 py-6 text-center text-xs text-emerald-400">© 2026 Hà Nội Xanh · Facebook: Hà Nội Xanh · TikTok: @hanoi_xanh</p></footer></div>;
}
