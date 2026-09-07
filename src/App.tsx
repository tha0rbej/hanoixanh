import { useState, useEffect } from "react";
import heroBg from "@/imports/image.png";
import logoImg from "@/imports/image-1.png";
import mapRefImg from "@/imports/image-2.png";

// Simple helper icon components using SVGs
const Icons = {
  MapPin: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  Calendar: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  Users: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  Heart: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  ),
  Search: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  CheckCircle: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Clock: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Phone: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  ),
  Mail: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  Send: ({ className = "w-5 h-5 text-white" }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
    </svg>
  ),
  ArrowRight: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
    </svg>
  ),
  Layers: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  Close: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
};

// Social Vector Icons
const SocialIcons = {
  Facebook: () => (
    <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  ),
  Instagram: () => (
    <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
    </svg>
  ),
  YouTube: () => (
    <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  ),
  TikTok: () => (
    <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
      <path d="M12.525 0h3.08c.12 1.341.69 2.502 1.62 3.398 1.05.998 2.45 1.542 3.93 1.542V8.04c-1.88 0-3.57-.61-4.95-1.65v8.32c0 4.16-3.38 7.55-7.55 7.55S1.1 18.87 1.1 14.71c0-4.17 3.39-7.56 7.55-7.56.45 0 .89.04 1.32.12v3.2a4.34 4.34 0 0 0-1.32-.2c-2.39 0-4.34 1.95-4.34 4.34s1.95 4.34 4.34 4.34 4.35-1.95 4.35-4.34V0z"/>
    </svg>
  )
};

// Sample map locations data matching the map reference
const MAP_LOCATIONS = [
  {
    id: 1,
    title: "Sông Tô Lịch - Đoạn Hoàng Quốc Việt",
    status: "Đang dọn dẹp",
    statusBg: "bg-emerald-100 text-emerald-800 border-emerald-300",
    district: "Cầu Giấy",
    volunteers: 45,
    trashCollected: "1.2 Tấn",
    date: "28/08/2026",
    coordinator: "Nguyễn Văn Hùng",
    coords: { top: "35%", left: "42%" },
    image: "https://images.unsplash.com/photo-1618477461853-cf6ed80faba5?w=500&auto=format&fit=crop"
  },
  {
    id: 2,
    title: "Sông Lừ - Khương Trung",
    status: "Cần viện trợ",
    statusBg: "bg-amber-100 text-amber-800 border-amber-300",
    district: "Thanh Xuân",
    volunteers: 60,
    trashCollected: "2.5 Tấn",
    date: "30/08/2026",
    coordinator: "Trần Thị Mai",
    coords: { top: "58%", left: "55%" },
    image: "https://images.unsplash.com/photo-1530587191325-3db32d826c18?w=500&auto=format&fit=crop"
  },
  {
    id: 3,
    title: "Kênh Nhuệ - Từ Liêm",
    status: "Hoàn thành",
    statusBg: "bg-blue-100 text-blue-800 border-blue-300",
    district: "Nam Từ Liêm",
    volunteers: 85,
    trashCollected: "4.1 Tấn",
    date: "20/08/2026",
    coordinator: "Lê Hoàng Long",
    coords: { top: "45%", left: "28%" },
    image: "https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=500&auto=format&fit=crop"
  },
  {
    id: 4,
    title: "Sông Sét - Định Công",
    status: "Đang dọn dẹp",
    statusBg: "bg-emerald-100 text-emerald-800 border-emerald-300",
    district: "Hoàng Mai",
    volunteers: 50,
    trashCollected: "1.8 Tấn",
    date: "29/08/2026",
    coordinator: "Đoàn Minh Anh",
    coords: { top: "70%", left: "62%" },
    image: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=500&auto=format&fit=crop"
  },
  {
    id: 5,
    title: "Sông Kim Ngưu - Thanh Nhàn",
    status: "Sắp ra quân",
    statusBg: "bg-purple-100 text-purple-800 border-purple-300",
    district: "Hai Bà Trưng",
    volunteers: 40,
    trashCollected: "Dự kiến 2 Tấn",
    date: "02/09/2026",
    coordinator: "Phạm Hải Đăng",
    coords: { top: "50%", left: "68%" },
    image: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=500&auto=format&fit=crop"
  }
];

// Photorealistic photographic placeholders of real urban cleanups & restored rivers
const BEFORE_AFTER_ITEMS = [
  {
    id: 1,
    location: "Sông Tô Lịch - Cầu Giấy",
    date: "Đợt 12 - Tháng 08/2026",
    trash: "3.5 Tấn rác thải",
    beforeImg: "https://images.unsplash.com/photo-1618477461853-cf6ed80faba5?w=800&auto=format&fit=crop",
    afterImg: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop"
  },
  {
    id: 2,
    location: "Sông Lừ - Khương Trung",
    date: "Đợt 08 - Tháng 07/2026",
    trash: "4.2 Tấn rác thải",
    beforeImg: "https://images.unsplash.com/photo-1530587191325-3db32d826c18?w=800&auto=format&fit=crop",
    afterImg: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800&auto=format&fit=crop"
  },
  {
    id: 3,
    location: "Sông Sét - Định Công",
    date: "Đợt 15 - Tháng 08/2026",
    trash: "2.8 Tấn rác thải",
    beforeImg: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=800&auto=format&fit=crop",
    afterImg: "https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=800&auto=format&fit=crop"
  }
];

export default function App() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(MAP_LOCATIONS[0]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("Tất cả");
  const [showDonateModal, setShowDonateModal] = useState(false);
  const [contactSubmitted, setContactSubmitted] = useState(false);
  const [donateSuccess, setDonateSuccess] = useState(false);

  // Form states
  const [contactForm, setContactForm] = useState({
    name: "",
    email: "",
    message: ""
  });

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 20) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactForm.name || !contactForm.email || !contactForm.message) return;
    setContactSubmitted(true);
    setTimeout(() => {
      setContactSubmitted(false);
      setContactForm({ name: "", email: "", message: "" });
    }, 4000);
  };

  const filteredLocations = MAP_LOCATIONS.filter((item) => {
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.district.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDistrict = selectedDistrict === "Tất cả" || item.district === selectedDistrict;
    return matchesSearch && matchesDistrict;
  });

  return (
    <div className="min-h-screen bg-[#f8faf9] text-gray-900 font-sans antialiased selection:bg-emerald-500 selection:text-white">
      
      {/* 1. HEADER & NAVIGATION */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled
            ? "bg-white/95 backdrop-blur-md shadow-md py-2 border-b border-emerald-100"
            : "bg-gradient-to-b from-black/70 via-black/40 to-transparent py-3"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          
          {/* Logo Brand with Circular Cropped Image & Pure White "HÀ NỘI" + Vibrant Green "XANH" */}
          <a href="#" className="flex items-center gap-3 group">
            <div className="relative w-11 h-11 rounded-full overflow-hidden border-2 border-emerald-500 shadow-md group-hover:scale-105 transition-transform bg-white p-0.5">
              <img
                src={logoImg}
                alt="Hà Nội Xanh Logo"
                className="w-full h-full object-cover rounded-full"
              />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-lg leading-tight tracking-tight">
                <span className={isScrolled ? "text-gray-900" : "text-white"}>HÀ NỘI </span>
                <span className="text-emerald-500">XANH</span>
              </span>
            </div>
          </a>

          {/* Navigation Menu */}
          <nav className="hidden md:flex items-center gap-1 lg:gap-2">
            {[
              { label: "Trang chủ", href: "#trang-chu" },
              { label: "Về Hà Nội Xanh", href: "#ve-ha-noi-xanh" },
              { label: "Chiến dịch", href: "#hoat-dong-noi-bat" },
              { label: "Tác động cộng đồng", href: "#tac-dong" },
              { label: "Tin tức và câu chuyện", href: "#tin-tuc" }
            ].map((link, idx) => (
              <a
                key={idx}
                href={link.href}
                className={`px-3.5 py-1.5 rounded-full text-base font-semibold transition-all ${
                  isScrolled
                    ? "text-gray-700 hover:text-emerald-700 hover:bg-emerald-50/80"
                    : "text-white/90 hover:text-white hover:bg-white/10"
                }`}
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Prominent QUYÊN TẶNG Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowDonateModal(true)}
              className="relative inline-flex items-center justify-center px-6 py-2.5 text-base font-black text-white bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 rounded-full shadow-lg shadow-orange-500/40 hover:shadow-orange-500/60 hover:scale-105 active:scale-95 transition-all duration-200 border border-orange-300/30 uppercase tracking-wider animate-pulse hover:animate-none"
            >
              <Icons.Heart className="w-5 h-5 mr-2 text-white animate-bounce" />
              QUYÊN TẶNG
            </button>
          </div>
        </div>
      </header>

      {/* 2. HERO BANNER */}
      <section id="trang-chu" className="relative min-h-[85vh] lg:min-h-[92vh] flex items-center justify-center pt-24 pb-16 overflow-hidden">
        {/* Background Image with Dark & Emerald Overlay */}
        <div className="absolute inset-0 z-0">
          <img
            src={heroBg}
            alt="Hà Nội Xanh Hero Banner"
            className="w-full h-full object-cover object-center scale-105 transform transition-transform duration-10000 ease-out"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-emerald-950/75 to-black/70" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.25),transparent_50%)]" />
        </div>

        {/* Hero Content */}
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-white mt-8">
          
          {/* Main Headline */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-tight mb-6 drop-shadow-md">
            <span className="text-white">VÌ MỘT HÀ NỘI </span>
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-emerald-400 to-lime-300 mt-1">
              XANH - SẠCH - ĐẸP
            </span>
          </h1>

          {/* Sub-headline Description */}
          <p className="max-w-3xl mx-auto text-lg sm:text-2xl text-emerald-100 font-medium leading-relaxed mb-10 drop-shadow">
            Hà Nội Xanh là nhóm tình nguyện trẻ chung tay làm sạch môi trường sống và lan tỏa lối sống xanh.
          </p>

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="#ban-do-hoat-dong"
              className="w-full sm:w-auto px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-xl shadow-emerald-900/40 hover:scale-105 active:scale-95 transition-all text-lg flex items-center justify-center gap-2 border border-emerald-400/30"
            >
              <Icons.MapPin className="w-5 h-5" />
              Xem Bản Đồ Hoạt Động
            </a>
            <a
              href="#lich-ra-quan"
              className="w-full sm:w-auto px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl backdrop-blur-md border border-white/30 hover:border-white/60 transition-all text-lg flex items-center justify-center gap-2"
            >
              <Icons.Calendar className="w-5 h-5" />
              Đăng Ký Tình Nguyện
            </a>
          </div>

          {/* Metrics Section */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 mt-16 max-w-5xl mx-auto pt-8 border-t border-white/15">
            {[
              { number: "250+", label: "Buổi ra quân" },
              { number: "1,200+", label: "Tấn rác vớt được" },
              { number: "15,000+", label: "Tình nguyện viên" },
              { number: "40+", label: "Tuyến sông được hồi sinh" }
            ].map((stat, idx) => (
              <div key={idx} className="bg-white/10 backdrop-blur-md p-4 sm:p-5 rounded-2xl border border-white/20 shadow-xl hover:border-emerald-400/50 transition-all">
                <div
                  style={{ fontSize: "41px" }}
                  className="font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-lime-300 to-amber-300 drop-shadow-lg leading-tight"
                >
                  {stat.number}
                </div>
                <div className="text-xs sm:text-sm text-emerald-100 font-bold mt-2 uppercase tracking-wide">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. VỀ HÀ NỘI XANH */}
      <section id="ve-ha-noi-xanh" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-emerald-100 text-emerald-800 text-sm font-bold uppercase tracking-wider">
                Sứ mệnh cộng đồng
              </div>
              <h2 className="text-3xl sm:text-4xl font-black text-gray-900 leading-tight">
                Khôi phục lại màu xanh trong lành cho từng góc sông Hà Nội
              </h2>
              <p className="text-gray-600 text-lg leading-relaxed">
                Được thành lập từ tình yêu môi trường sâu sắc, nhóm <strong>Hà Nội Xanh</strong> quy tụ những bạn trẻ không ngại khó khăn, lội nước sâu dọn sạch bùn bẩn, rác thải tại sông Tô Lịch, sông Nhuệ, sông Lừ, sông Sét...
              </p>
              <div className="space-y-4 pt-2">
                {[
                  "Dọn dẹp rác thải trực tiếp tại các điểm nóng sông hồ ô nhiễm nặng.",
                  "Tuyên truyền nâng cao ý thức phân loại rác cho cư dân hai bên bờ sông.",
                  "Tái chế rác thải nhựa và trồng bổ sung cây xanh ven bờ."
                ].map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <div className="p-1 rounded-full bg-emerald-100 text-emerald-700 mt-1">
                      <Icons.CheckCircle className="w-5 h-5" />
                    </div>
                    <span className="text-gray-700 font-medium text-base">{item}</span>
                  </div>
                ))}
              </div>

              {/* Positioned Badge */}
              <div className="mt-6 pt-4 border-t border-gray-100 flex items-center gap-4 bg-emerald-50/70 p-4 rounded-xl border border-emerald-100">
                <div className="w-12 h-12 rounded-xl bg-orange-500 text-white flex items-center justify-center font-bold text-xl shadow-md shrink-0">
                  ★
                </div>
                <div>
                  <div className="text-xl font-black text-gray-900">100% Tinh thần phi lợi nhuận & tự nguyện</div>
                  <div className="text-xs text-gray-600 font-medium">Tất cả kinh phí và hoạt động được công khai minh bạch</div>
                </div>
              </div>
            </div>

            <div className="relative space-y-4">
              <div className="relative rounded-2xl overflow-hidden shadow-2xl border-4 border-white bg-emerald-900">
                <img
                  src={heroBg}
                  alt="Tình nguyện viên Hà Nội Xanh"
                  className="w-full h-[400px] object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex items-end p-6">
                  <div className="text-white space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-300 bg-emerald-950/80 px-2.5 py-0.5 rounded">
                      Hình ảnh thực tế
                    </span>
                    <p className="text-base font-bold text-white drop-shadow">
                      Các tình nguyện viên trầm mình vớt rác trên dòng sông Tô Lịch
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* 4. HOẠT ĐỘNG NỔI BẬT */}
      <section id="hoat-dong-noi-bat" className="py-20 bg-gray-50 border-t border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-5xl font-black text-gray-900 mb-4">
              HOẠT ĐỘNG NỔI BẬT
            </h2>
            <p className="text-gray-600 text-lg leading-relaxed">
              So sánh hình ảnh Thực trạng trước khi dọn dẹp và Thành quả sau khi Hà Nội Xanh hoàn thành chiến dịch.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {BEFORE_AFTER_ITEMS.map((card) => (
              <div
                key={card.id}
                className="bg-white rounded-2xl overflow-hidden shadow-lg border border-gray-200 hover:shadow-xl transition-all flex flex-col justify-between group"
              >
                <div>
                  <div className="relative grid grid-cols-2 gap-0.5 bg-gray-900 h-56 overflow-hidden">
                    <div className="relative group-hover:opacity-95 transition-opacity">
                      <img src={card.beforeImg} alt="Trước dọn dẹp" className="w-full h-full object-cover" />
                      <span className="absolute top-2 left-2 bg-red-600/90 backdrop-blur-sm text-white text-[10px] font-black uppercase px-2 py-0.5 rounded shadow">
                        Trước
                      </span>
                    </div>

                    <div className="relative group-hover:opacity-95 transition-opacity">
                      <img src={card.afterImg} alt="Sau dọn dẹp" className="w-full h-full object-cover" />
                      <span className="absolute top-2 right-2 bg-emerald-600/90 backdrop-blur-sm text-white text-[10px] font-black uppercase px-2 py-0.5 rounded shadow">
                        Sau
                      </span>
                    </div>

                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="bg-gray-950/90 border border-emerald-400 text-emerald-300 text-[10px] font-black uppercase px-2 py-1 rounded-full shadow-lg">
                        VS
                      </span>
                    </div>
                  </div>

                  <div className="p-6">
                    <div className="flex items-center justify-between text-xs text-gray-500 font-semibold mb-2">
                      <span className="text-emerald-700 font-bold">{card.date}</span>
                      <span className="bg-orange-100 text-orange-800 px-2 py-0.5 rounded font-bold">{card.trash}</span>
                    </div>
                    <h3 className="font-extrabold text-gray-900 text-lg leading-snug group-hover:text-emerald-600 transition-colors">
                      {card.location}
                    </h3>
                  </div>
                </div>

                <div className="p-6 pt-0">
                  <a
                    href="#ban-do-hoat-dong"
                    className="w-full py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-extrabold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors border border-emerald-200"
                  >
                    Xem chi tiết điểm này <Icons.ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* 5. LỊCH RA QUÂN VÀ ĐIỂM NÓNG */}
      <section id="lich-ra-quan" className="py-20 bg-emerald-950 text-white relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-5xl font-black text-white mb-4">
              Lịch ra quân & Điểm nóng cần viện trợ
            </h2>
            <p className="text-emerald-200 text-lg">
              Đăng ký tham gia ngay cùng Hà Nội Xanh cuối tuần này để chung tay mang lại diện mạo mới cho các dòng sông.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            {[
              {
                title: "Dọn dẹp Sông Lừ - Khương Trung",
                date: "Chủ Nhật, 30/08/2026",
                time: "07:30 - 11:30",
                location: "Cầu Khương Đình, Thanh Xuân",
                needed: "50 Tình nguyện viên",
                status: "Đang mở đăng ký",
                badgeBg: "bg-emerald-500"
              },
              {
                title: "Chiến dịch Sông Tô Lịch xanh",
                date: "Thứ Bảy, 05/09/2026",
                time: "08:00 - 12:00",
                location: "Đoạn Hoàng Quốc Việt, Cầu Giấy",
                needed: "80 Tình nguyện viên",
                status: "Sắp diễn ra",
                badgeBg: "bg-amber-500"
              },
              {
                title: "Trồng cây ven Sông Kim Ngưu",
                date: "Chủ Nhật, 12/09/2026",
                time: "08:00 - 11:00",
                location: "Cầu Mai Động, Hai Bà Trưng",
                needed: "30 Tình nguyện viên",
                status: "Chuẩn bị",
                badgeBg: "bg-blue-500"
              }
            ].map((event, idx) => (
              <div
                key={idx}
                className="bg-white/10 border border-white/15 rounded-2xl p-6 backdrop-blur-md flex flex-col justify-between hover:border-emerald-400/60 transition-all hover:-translate-y-1 shadow-lg"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold text-white ${event.badgeBg}`}>
                      {event.status}
                    </span>
                    <span className="text-xs text-emerald-300 font-semibold flex items-center gap-1">
                      <Icons.Users className="w-4 h-4" /> {event.needed}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-4">{event.title}</h3>
                  <div className="space-y-2 text-sm text-gray-200">
                    <p className="flex items-center gap-2">
                      <Icons.Calendar className="w-4 h-4 text-emerald-400" /> {event.date}
                    </p>
                    <p className="flex items-center gap-2">
                      <Icons.Clock className="w-4 h-4 text-emerald-400" /> {event.time}
                    </p>
                    <p className="flex items-center gap-2">
                      <Icons.MapPin className="w-4 h-4 text-emerald-400" /> {event.location}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => alert(`Đăng ký tham gia: ${event.title}`)}
                  className="mt-6 w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-extrabold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-md"
                >
                  Đăng ký tham gia ngay
                  <Icons.ArrowRight className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="text-center pt-4">
            <a
              href="#ban-do-hoat-dong"
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-white/10 hover:bg-white/20 text-emerald-200 hover:text-white font-extrabold text-base rounded-full border border-white/20 hover:border-emerald-400 transition-all shadow-lg group"
            >
              <span>Xem tất cả lịch ra quân</span>
              <Icons.ArrowRight className="w-5 h-5 text-emerald-400 group-hover:translate-x-1 transition-transform" />
            </a>
          </div>

        </div>
      </section>

      {/* 6. BẢN ĐỒ HOẠT ĐỘNG (Meta-text removed, 25+ Điểm đang theo dõi cleanly integrated in floating stat badge) */}
      <section id="ban-do-hoat-dong" className="py-20 bg-gray-50 border-t border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Section Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 pb-6 border-b border-gray-200 gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-emerald-100 text-emerald-800 text-xs font-bold uppercase tracking-wider mb-2">
                Bản đồ tương tác
              </div>
              <h2 className="text-3xl sm:text-4xl font-black text-gray-900">
                Bản đồ tuyến sông & Điểm nóng Hà Nội Xanh
              </h2>
              <p className="text-gray-600 mt-1">
                Theo dõi tiến độ dọn dẹp thực tế, khối lượng rác vớt được và các điểm chuẩn bị ra quân.
              </p>
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Icons.Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Tìm theo khu vực hoặc tên sông..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 w-64 shadow-sm"
                />
              </div>

              <select
                value={selectedDistrict}
                onChange={(e) => setSelectedDistrict(e.target.value)}
                className="py-2 px-3 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm font-medium text-gray-700"
              >
                <option value="Tất cả">Tất cả quận/huyện</option>
                <option value="Cầu Giấy">Cầu Giấy</option>
                <option value="Thanh Xuân">Thanh Xuân</option>
                <option value="Nam Từ Liêm">Nam Từ Liêm</option>
                <option value="Hoàng Mai">Hoàng Mai</option>
                <option value="Hai Bà Trưng">Hai Bà Trưng</option>
              </select>
            </div>
          </div>

          {/* Map Layout Grid: Left Sidebar List + Right Interactive Map Container */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-200">
            
            {/* Left Column: Location Cards List */}
            <div className="lg:col-span-5 p-4 sm:p-6 bg-gray-50 border-r border-gray-200 max-h-[600px] overflow-y-auto space-y-4">
              <div className="flex items-center justify-between text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                <span>Danh sách điểm dọn dẹp ({filteredLocations.length})</span>
                <span>Trạng thái</span>
              </div>

              {filteredLocations.map((loc) => (
                <div
                  key={loc.id}
                  onClick={() => setSelectedLocation(loc)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    selectedLocation.id === loc.id
                      ? "bg-emerald-50 border-emerald-500 shadow-md ring-2 ring-emerald-400/20"
                      : "bg-white border-gray-200 hover:border-emerald-300 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold text-gray-900 text-base leading-snug">{loc.title}</h4>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border shrink-0 ${loc.statusBg}`}>
                      {loc.status}
                    </span>
                  </div>

                  <p className="text-xs text-gray-500 font-semibold mt-1 flex items-center gap-1">
                    <Icons.MapPin className="w-3.5 h-3.5 text-gray-400" /> Quận {loc.district}
                  </p>

                  <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-gray-100 text-xs">
                    <div>
                      <span className="text-gray-400 block">Tình nguyện viên:</span>
                      <span className="font-bold text-emerald-800">{loc.volunteers} người</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block">Rác gom được:</span>
                      <span className="font-bold text-orange-600">{loc.trashCollected}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Right Column: Visual Map Simulation */}
            <div className="lg:col-span-7 flex flex-col justify-between relative bg-emerald-950 min-h-[520px]">
              
              {/* Satellite Map Image with brightness adjustment */}
              <div className="absolute inset-0 z-0 opacity-55 mix-blend-overlay pointer-events-none filter brightness-110">
                <img
                  src={mapRefImg}
                  alt="Hà Nội Xanh Map Texture"
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Map Canvas with Interactive Pins */}
              <div className="relative z-10 p-6 flex-1 min-h-[360px]">
                
                {/* Rivers SVG Overlay */}
                <svg className="absolute inset-0 w-full h-full stroke-emerald-400/30 fill-none pointer-events-none" strokeWidth="4">
                  <path d="M 50 20 Q 150 120 280 200 T 450 350 T 600 480" strokeWidth="12" className="stroke-teal-500/40" />
                  <path d="M 200 50 Q 300 220 400 280 T 520 420" strokeWidth="8" className="stroke-emerald-400/30" />
                </svg>

                {/* Numbered Pins */}
                {MAP_LOCATIONS.map((loc) => (
                  <button
                    key={loc.id}
                    onClick={() => setSelectedLocation(loc)}
                    style={{ top: loc.coords.top, left: loc.coords.left }}
                    className={`absolute transform -translate-x-1/2 -translate-y-1/2 group z-20 transition-all ${
                      selectedLocation.id === loc.id ? "scale-125 z-30" : "hover:scale-110"
                    }`}
                  >
                    <div className="relative flex items-center justify-center">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-white text-white font-extrabold text-xs ${
                        selectedLocation.id === loc.id ? "bg-orange-500 ring-4 ring-orange-400/40 animate-bounce" : "bg-emerald-600"
                      }`}>
                        {loc.id}
                      </span>
                      {selectedLocation.id === loc.id && (
                        <div className="absolute bottom-full mb-2 bg-gray-900 text-white text-xs py-1 px-2.5 rounded shadow-xl whitespace-nowrap font-bold border border-emerald-400/40">
                          {loc.title}
                        </div>
                      )}
                    </div>
                  </button>
                ))}

                {/* Top Corner Floating Map Badges (Including 25+ Điểm đang theo dõi) */}
                <div className="absolute top-4 right-4 flex flex-col sm:flex-row items-end sm:items-center gap-2">
                  <div className="bg-emerald-900/90 backdrop-blur-md text-emerald-200 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 border border-emerald-500/40 shadow-lg">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>25+ ĐIỂM ĐANG THEO DÕI</span>
                  </div>
                  <div className="bg-black/70 backdrop-blur-md text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 border border-white/20 shadow-lg">
                    <Icons.Layers className="w-4 h-4 text-emerald-400" />
                    Bản đồ vệ tinh sông ngòi
                  </div>
                </div>

                {/* Status Legend Key */}
                <div className="absolute bottom-4 left-4 bg-black/80 backdrop-blur-md text-white p-2.5 rounded-xl border border-white/20 shadow-xl flex flex-wrap items-center gap-3 text-xs font-semibold z-20">
                  <span className="text-emerald-300 font-bold uppercase text-[10px] tracking-wider block w-full sm:w-auto">Chú thích:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500 border border-white/50" />
                    <span>Đã xử lý</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white/50" />
                    <span>Đang dọn dẹp</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 border border-white/50" />
                    <span>Cần viện trợ</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-500 border border-white/50" />
                    <span>Sắp ra quân</span>
                  </div>
                </div>

              </div>

              {/* Bottom Selected Location Detail Card */}
              <div className="relative z-20 bg-white p-5 border-t border-gray-200 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4 w-full sm:w-auto">
                  <img
                    src={selectedLocation.image}
                    alt={selectedLocation.title}
                    className="w-16 h-16 rounded-xl object-cover border border-gray-200 shrink-0 shadow-sm"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                        {selectedLocation.district}
                      </span>
                      <span className="text-xs text-gray-500">Cập nhật: {selectedLocation.date}</span>
                    </div>
                    <h3 className="text-base font-extrabold text-gray-900 leading-tight mt-0.5">
                      {selectedLocation.title}
                    </h3>
                    <p className="text-xs text-gray-600 mt-1">
                      Trưởng nhóm: <strong className="text-gray-800">{selectedLocation.coordinator}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto shrink-0 justify-end">
                  <div className="text-right hidden sm:block mr-2">
                    <span className="text-xs text-gray-500 block">Đã vớt:</span>
                    <span className="text-base font-black text-orange-600">{selectedLocation.trashCollected}</span>
                  </div>
                  <button
                    onClick={() => alert(`Bạn đã đăng ký tham gia điểm: ${selectedLocation.title}`)}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl shadow-md transition-all hover:scale-105 active:scale-95"
                  >
                    Tham Gia Ngay
                  </button>
                </div>
              </div>

            </div>

          </div>

        </div>
      </section>

      {/* 7. TÁC ĐỘNG CỘNG ĐỒNG */}
      <section id="tac-dong" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="px-3 py-1 rounded-md bg-emerald-100 text-emerald-800 text-xs font-bold uppercase tracking-wider">
              Tác động cộng đồng
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mt-3">
              Mỗi đóng góp đều làm thay đổi dòng sông
            </h2>
            <p className="text-gray-600 mt-2 text-lg">
              Sự hỗ trợ của bạn giúp trang bị đồ bảo hộ chống độc, thuyền gom rác và xẻng chuyên dụng cho các tình nguyện viên.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                title: "100.000 VNĐ",
                desc: "Trang bị 01 bộ quần áo bảo hộ lội nước chống thấm & găng tay cao cấp cho tình nguyện viên."
              },
              {
                title: "500.000 VNĐ",
                desc: "Cung cấp cào rác chuyên dụng, xô chứa rác thải nguy hại và dụng cụ khử khuẩn cho 01 đội."
              },
              {
                title: "2.000.000 VNĐ",
                desc: "Tài trợ toàn bộ chi phí vận chuyển & xử lý phân loại rác thải cho 01 buổi ra quân quy mô lớn."
              }
            ].map((tier, idx) => (
              <div key={idx} className="p-8 rounded-2xl bg-gray-50 border border-gray-200 hover:border-emerald-400 hover:shadow-xl transition-all flex flex-col justify-between">
                <div>
                  <h3 className="text-2xl font-black text-emerald-800 mb-3">{tier.title}</h3>
                  <p className="text-gray-600 leading-relaxed text-sm">{tier.desc}</p>
                </div>
                <button
                  onClick={() => setShowDonateModal(true)}
                  className="mt-6 w-full py-3 bg-emerald-800 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors text-sm"
                >
                  Ủng hộ gói này
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 8. TIN TỨC VÀ CÂU CHUYỆN */}
      <section id="tin-tuc" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-12">
            <div>
              <h2 className="text-3xl sm:text-4xl font-black text-gray-900">
                TIN TỨC VÀ CÂU CHUYỆN
              </h2>
            </div>
            <a href="#" className="text-emerald-700 font-bold hover:underline mt-4 sm:mt-0 flex items-center gap-1">
              Xem tất cả bài viết <Icons.ArrowRight className="w-4 h-4" />
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                title: "Hành trình 500 ngày hồi sinh sông Tô Lịch của người trẻ Thủ đô",
                date: "25/08/2026",
                author: "Ban Truyền Thông",
                img: "https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=600&auto=format&fit=crop"
              },
              {
                title: "Những chiến sĩ 'lội bùn' giữa lòng thành phố và tinh thần không ngại khó",
                date: "22/08/2026",
                author: "Nhật Ký Tình Nguyện",
                img: "https://images.unsplash.com/photo-1618477461853-cf6ed80faba5?w=600&auto=format&fit=crop"
              },
              {
                title: "Bí quyết phân loại và tái chế rác thải nhựa sau mỗi đợt ra quân",
                date: "18/08/2026",
                author: "Đội Môi Trường",
                img: "https://images.unsplash.com/photo-1530587191325-3db32d826c18?w=600&auto=format&fit=crop"
              }
            ].map((news, idx) => (
              <div key={idx} className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-gray-200 flex flex-col">
                <img src={news.img} alt={news.title} className="w-full h-48 object-cover" />
                <div className="p-6 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="text-xs text-emerald-700 font-semibold mb-2">{news.date} • {news.author}</div>
                    <h3 className="font-bold text-gray-900 text-lg hover:text-emerald-700 cursor-pointer transition-colors leading-snug">
                      {news.title}
                    </h3>
                  </div>
                  <a href="#" className="mt-4 text-emerald-700 font-bold text-sm hover:underline inline-flex items-center gap-1">
                    Đọc tiếp <Icons.ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 9. FOOTER */}
      <footer className="bg-emerald-950 text-white border-t border-emerald-900">
        
        {/* Upper Contact Message Form Banner */}
        <div className="border-b border-emerald-900/80 py-16 bg-emerald-900/40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
              
              {/* Form Intro Copy */}
              <div className="lg:col-span-5 space-y-4">
                <span className="px-3 py-1 rounded bg-emerald-800 text-emerald-200 text-xs font-bold uppercase tracking-wider">
                  Liên hệ trực tiếp
                </span>
                <h3 className="text-3xl sm:text-4xl font-black text-white leading-tight">
                  Gửi tin nhắn cho Hà Nội Xanh
                </h3>
                <p className="text-emerald-200 text-base leading-relaxed">
                  Bạn có câu hỏi hoặc muốn đồng hành cùng chúng tôi? Hãy để lại lời nhắn nhé!
                </p>
                <div className="p-4 rounded-xl bg-emerald-950/80 border border-emerald-800 text-sm space-y-2 mt-4">
                  <p className="flex items-center gap-2 text-emerald-300 font-semibold">
                    <Icons.Clock className="w-4 h-4 text-orange-400" />
                    Giờ làm việc: 08:00 – 17:30 (Thứ 2 – Chủ Nhật)
                  </p>
                  <p className="text-emerald-400 text-xs">
                    Chúng tôi phản hồi tin nhắn trong vòng 24 giờ làm việc.
                  </p>
                </div>
              </div>

              {/* Interactive Contact Message Form */}
              <div className="lg:col-span-7 bg-white text-gray-900 p-6 sm:p-8 rounded-2xl shadow-2xl border border-emerald-100">
                {contactSubmitted ? (
                  <div className="py-12 text-center space-y-4">
                    <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-2xl font-bold">
                      ✓
                    </div>
                    <h4 className="text-2xl font-black text-gray-900">Cảm ơn bạn đã gửi tin nhắn!</h4>
                    <p className="text-gray-600 max-w-md mx-auto">
                      Hà Nội Xanh đã nhận được lời nhắn của bạn và sẽ liên hệ phản hồi qua email sớm nhất có thể.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleContactSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                          Họ và tên <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Nguyễn Văn A"
                          value={contactForm.name}
                          onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                          Địa chỉ Email <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="email"
                          required
                          placeholder="example@gmail.com"
                          value={contactForm.email}
                          onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        Lời nhắn / Câu hỏi <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        required
                        rows={4}
                        placeholder="Hãy chia sẻ ý kiến, thắc mắc hoặc mong muốn tham gia của bạn..."
                        value={contactForm.message}
                        onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white resize-none"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-xl shadow-lg transition-all text-base flex items-center justify-center gap-2"
                    >
                      <Icons.Send className="w-5 h-5 text-white" />
                      Gửi tin nhắn
                    </button>
                  </form>
                )}
              </div>

            </div>
          </div>
        </div>

        {/* Lower Main Footer Info & Social Links */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
            
            {/* Col 1: Brand & Logo */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-emerald-400 bg-white p-0.5">
                  <img src={logoImg} alt="Logo Hà Nội Xanh" className="w-full h-full object-cover rounded-full" />
                </div>
                <span className="font-extrabold text-xl tracking-tight">
                  <span className="text-white">HÀ NỘI </span>
                  <span className="text-emerald-400">XANH</span>
                </span>
              </div>
              <p className="text-emerald-200/80 text-sm leading-relaxed">
                Dự án cộng đồng bảo vệ môi trường phi lợi nhuận. Cùng nhau khôi phục lại sắc xanh tự nhiên cho dòng sông Thủ đô.
              </p>
              
              {/* Vector Social Icons (FB, IG, YT, TikTok) */}
              <div className="pt-2">
                <p className="text-xs font-bold text-emerald-400 uppercase mb-3">Kết nối cùng Hà Nội Xanh</p>
                <div className="flex items-center gap-3">
                  {[
                    { icon: <SocialIcons.Facebook />, label: "Facebook", href: "#" },
                    { icon: <SocialIcons.Instagram />, label: "Instagram", href: "#" },
                    { icon: <SocialIcons.YouTube />, label: "YouTube", href: "#" },
                    { icon: <SocialIcons.TikTok />, label: "TikTok", href: "#" }
                  ].map((soc, idx) => (
                    <a
                      key={idx}
                      href={soc.href}
                      aria-label={soc.label}
                      title={soc.label}
                      className="w-10 h-10 rounded-full bg-emerald-900/80 hover:bg-emerald-500 hover:text-emerald-950 text-emerald-200 flex items-center justify-center transition-all border border-emerald-700/50 hover:scale-110 shadow-sm"
                    >
                      {soc.icon}
                    </a>
                  ))}
                </div>
              </div>
            </div>

            {/* Col 2: Navigation Links */}
            <div>
              <h4 className="text-sm font-extrabold uppercase text-emerald-400 tracking-wider mb-4">
                Điều Hướng
              </h4>
              <ul className="space-y-2.5 text-sm text-emerald-200/80 font-medium">
                <li><a href="#trang-chu" className="hover:text-white transition-colors">Trang chủ</a></li>
                <li><a href="#ve-ha-noi-xanh" className="hover:text-white transition-colors">Về Hà Nội Xanh</a></li>
                <li><a href="#hoat-dong-noi-bat" className="hover:text-white transition-colors">Hoạt động nổi bật</a></li>
                <li><a href="#ban-do-hoat-dong" className="hover:text-white transition-colors">Bản đồ điểm nóng</a></li>
                <li><a href="#tac-dong" className="hover:text-white transition-colors">Tác động cộng đồng</a></li>
                <li><a href="#tin-tuc" className="hover:text-white transition-colors">Tin tức và câu chuyện</a></li>
              </ul>
            </div>

            {/* Col 3: Contact Info & Working Hours */}
            <div>
              <h4 className="text-sm font-extrabold uppercase text-emerald-400 tracking-wider mb-4">
                Thông Tin Liên Hệ
              </h4>
              <ul className="space-y-3 text-sm text-emerald-200/80">
                <li className="flex items-start gap-2.5">
                  <Icons.MapPin className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Trụ sở: Cầu Giấy, Thành phố Hà Nội, Việt Nam</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Icons.Phone className="w-5 h-5 text-emerald-400 shrink-0" />
                  <span>Hotline: 0988 123 456</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Icons.Mail className="w-5 h-5 text-emerald-400 shrink-0" />
                  <span>Email: hanoixanh.org@gmail.com</span>
                </li>
                <li className="flex items-center gap-2.5 font-bold text-amber-300 pt-1">
                  <Icons.Clock className="w-5 h-5 text-amber-400 shrink-0" />
                  <span>Giờ làm việc: 08:00 – 17:30</span>
                </li>
              </ul>
            </div>

            {/* Col 4: Urgent Support / Call to Action */}
            <div className="bg-emerald-900/40 p-5 rounded-2xl border border-emerald-800">
              <h4 className="text-sm font-extrabold uppercase text-orange-400 tracking-wider mb-2">
                Báo Điểm Ô Nhiễm
              </h4>
              <p className="text-xs text-emerald-200/90 leading-relaxed mb-4">
                Phát hiện khúc sông hoặc kênh rạch ô nhiễm rác thải nghiêm trọng cần xử lý? Báo ngay cho ban điều hành.
              </p>
              <button
                onClick={() => alert("Cảm ơn bạn! Hãy gửi thông tin địa điểm ô nhiễm qua phần Gửi tin nhắn.")}
                className="w-full py-2.5 bg-orange-500 hover:bg-orange-400 text-white font-bold rounded-lg text-xs tracking-wide uppercase shadow-md transition-colors"
              >
                Gửi Tọa Độ Báo Ô Nhiễm
              </button>
            </div>

          </div>

          <div className="mt-12 pt-8 border-t border-emerald-900 text-center text-xs text-emerald-400/60 font-medium">
            © 2026 Hà Nội Xanh - Dự án cộng đồng phi lợi nhuận vì môi trường Hà Nội. All rights reserved.
          </div>
        </div>

      </footer>

      {/* DONATION MODAL */}
      {showDonateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 relative shadow-2xl border border-emerald-100 text-gray-900">
            <button
              onClick={() => setShowDonateModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1"
            >
              <Icons.Close className="w-6 h-6" />
            </button>

            {donateSuccess ? (
              <div className="text-center py-8 space-y-4">
                <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-3xl font-bold">
                  ♥
                </div>
                <h3 className="text-2xl font-black text-emerald-950">Chân thành cảm ơn!</h3>
                <p className="text-sm text-gray-600">
                  Sự ủng hộ quý báu của bạn là nguồn động lực to lớn giúp Hà Nội Xanh duy trì các buổi ra quân vớt rác hàng tuần.
                </p>
                <button
                  onClick={() => {
                    setDonateSuccess(false);
                    setShowDonateModal(false);
                  }}
                  className="px-6 py-2.5 bg-emerald-600 text-white font-bold rounded-xl text-sm"
                >
                  Đóng cửa sổ
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 text-orange-500 font-bold text-xs uppercase mb-1">
                  <Icons.Heart className="w-4 h-4" /> Đồng hành cùng Hà Nội Xanh
                </div>
                <h3 className="text-2xl font-black text-gray-900 mb-2">Quyên Tặng Quỹ Môi Trường</h3>
                <p className="text-xs text-gray-500 mb-6">
                  Mọi khoản quyên góp đều được sử dụng minh bạch 100% cho trang thiết bị bảo hộ và chi phí thu gom rác.
                </p>

                <div className="space-y-3 mb-6">
                  <label className="block text-xs font-bold text-gray-700 uppercase">Chọn mức quyên góp</label>
                  <div className="grid grid-cols-3 gap-2">
                    {["50.000đ", "100.000đ", "500.000đ"].map((amount, idx) => (
                      <button
                        key={idx}
                        onClick={() => setDonateSuccess(true)}
                        className="py-2.5 border-2 border-emerald-500 text-emerald-800 font-extrabold rounded-xl hover:bg-emerald-50 transition-colors text-sm"
                      >
                        {amount}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1.5 mb-6">
                  <p className="font-bold text-gray-800">Chuyển khoản trực tiếp:</p>
                  <p className="text-gray-600">STK: <strong className="text-gray-900">8888 6666 9999</strong> (MB Bank)</p>
                  <p className="text-gray-600">Chủ tài khoản: <strong className="text-gray-900">QUY HA NOI XANH</strong></p>
                  <p className="text-gray-600">Cú pháp: <em className="text-emerald-700">HNX [Họ tên] [SĐT]</em></p>
                </div>

                <button
                  onClick={() => setDonateSuccess(true)}
                  className="w-full py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-black rounded-xl shadow-lg transition-all text-sm uppercase tracking-wider"
                >
                  Xác Nhận Quyên Tặng
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
