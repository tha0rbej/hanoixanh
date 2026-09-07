import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import logoImg from "@/imports/image-1.png";

const links = [["Trang chủ", "/"], ["Về Hà Nội Xanh", "/ve-ha-noi-xanh"], ["Chiến dịch", "/chien-dich"], ["Bản đồ", "/ban-do"], ["Tác động", "/tac-dong"], ["Tin tức", "/tin-tuc"]];

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { const onScroll = () => setScrolled(window.scrollY > 20); onScroll(); window.addEventListener("scroll", onScroll, { passive: true }); return () => window.removeEventListener("scroll", onScroll); }, []);
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => { if (!menuOpen) return; const close = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false); document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close); }, [menuOpen]);
  const overHero = location.pathname === "/" && !scrolled && !menuOpen;
  const routeIsActive = (to: string, routerActive: boolean) => routerActive || (to === "/chien-dich" && location.pathname.startsWith("/dang-ky/")) || (to === "/tac-dong" && location.pathname === "/ung-ho");
  const navClass = (to: string) => ({ isActive }: { isActive: boolean }) => `rounded-full px-3 py-2 text-sm font-semibold ${routeIsActive(to, isActive) ? "bg-emerald-100 text-emerald-800" : overHero ? "text-white hover:bg-white/10" : "text-gray-700 hover:bg-emerald-50"}`;
  return <header className={`fixed inset-x-0 top-0 z-50 border-b transition-all ${overHero ? "border-transparent bg-gradient-to-b from-black/70 to-transparent py-3" : "border-emerald-100 bg-white/95 py-2 shadow-md backdrop-blur-md"}`}>
    <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8"><Link to="/" className="flex items-center gap-3"><img src={logoImg} alt="Hà Nội Xanh" className="h-11 w-11 rounded-full border-2 border-emerald-500 bg-white object-cover p-0.5" /><span className="hidden font-extrabold min-[400px]:inline"><span className={overHero ? "text-white" : "text-gray-900"}>HÀ NỘI </span><span className="text-emerald-500">XANH</span></span></Link>
      <nav aria-label="Điều hướng chính" className="hidden items-center gap-1 lg:flex">{links.map(([label, to]) => <NavLink key={to} to={to} end={to === "/"} className={navClass(to)}>{label}</NavLink>)}</nav>
      <div className="flex items-center gap-2"><Link to="/ung-ho" className="rounded-full bg-orange-500 px-4 py-2 text-sm font-black text-white shadow-lg hover:bg-orange-600">ỦNG HỘ</Link><button type="button" aria-expanded={menuOpen} aria-controls="mobile-menu" aria-label={menuOpen ? "Đóng menu" : "Mở menu"} onClick={() => setMenuOpen((x) => !x)} className={`rounded-lg p-2 text-2xl lg:hidden ${overHero ? "text-white" : "text-gray-900"}`}>{menuOpen ? "×" : "☰"}</button></div>
    </div>
    {menuOpen && <nav id="mobile-menu" aria-label="Điều hướng di động" className="border-t border-emerald-100 bg-white px-4 py-3 shadow-lg lg:hidden">{links.map(([label, to]) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `block rounded-lg px-4 py-3 font-semibold ${routeIsActive(to, isActive) ? "bg-emerald-100 text-emerald-800" : "text-gray-700"}`}>{label}</NavLink>)}</nav>}
  </header>;
}
